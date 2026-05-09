import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TELEGRAM_BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID     = process.env.TELEGRAM_CHAT_ID;

const OVERDUE_DAYS_THRESHOLD = 3;
const DUE_SOON_DAYS          = 2;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' }),
  });
  const data = await res.json();
  if (!data.ok) console.error('Telegram error:', JSON.stringify(data));
  return data.ok;
}

function taka(n) { return `৳${Number(n).toLocaleString('en-BD')}`; }

function daysBetween(dateStr) {
  const due = new Date(dateStr);
  const now = new Date();
  now.setHours(0,0,0,0);
  due.setHours(0,0,0,0);
  return Math.floor((now - due) / (1000 * 60 * 60 * 24));
}

async function alreadyAlerted(alertType, customerId) {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('alert_log').select('id').eq('alert_type', alertType)
    .eq('customer_id', customerId).gte('sent_at', `${today}T00:00:00Z`).limit(1);
  return data && data.length > 0;
}

async function logAlert(alertType, customerId, message) {
  await supabase.from('alert_log').insert({ alert_type: alertType, customer_id: customerId, message, channel: 'telegram' });
}

async function checkOverdue() {
  console.log('Checking overdue payments...');
  const today = new Date().toISOString().split('T')[0];
  const { data: bills, error } = await supabase
    .from('bills').select('id, customer_id, bill_month, amount, due_date, status')
    .in('status', ['unpaid', 'partial']).lt('due_date', today);
  if (error) { console.error('Bills query error:', error.message); return; }
  if (!bills || bills.length === 0) { console.log('No overdue bills.'); return; }

  const customerIds = [...new Set(bills.map(b => b.customer_id))];
  const { data: customers, error: custErr } = await supabase
    .from('customers').select('customer_id, name, phone, area, package_mbps, package_price')
    .in('customer_id', customerIds).eq('status', 'active');
  if (custErr) { console.error('Customer query error:', custErr.message); return; }

  const custMap = {};
  (customers || []).forEach(c => custMap[c.customer_id] = c);
  const enriched = bills
    .map(b => ({ ...b, ...custMap[b.customer_id], days_overdue: daysBetween(b.due_date) }))
    .filter(b => b.name && b.days_overdue > OVERDUE_DAYS_THRESHOLD)
    .sort((a, b) => b.days_overdue - a.days_overdue);

  if (enriched.length === 0) { console.log('No bills past threshold.'); return; }

  const alerted = await alreadyAlerted('overdue_summary', 'SUMMARY');
  if (!alerted) {
    const total = enriched.reduce((s, b) => s + b.amount, 0);
    const msg = [
      `🔴 <b>SVCN — Overdue Bills</b>`, ``,
      `📊 <b>${enriched.length} customers</b> overdue`,
      `💸 Total: <b>${taka(total)}</b>`, ``, `Top overdue:`,
      ...enriched.slice(0, 5).map(b => `• ${b.name} (${b.customer_id}) — ${taka(b.amount)} — <b>${b.days_overdue}d late</b>`),
      ``, `📅 ${new Date().toLocaleDateString('en-BD', { timeZone: 'Asia/Dhaka' })}`
    ].join('\n');
    await sendTelegram(msg);
    await logAlert('overdue_summary', 'SUMMARY', msg);
    console.log('Overdue summary sent.');
  }

  for (const bill of enriched.filter(b => b.days_overdue > 7)) {
    const a = await alreadyAlerted('overdue_severe', bill.customer_id);
    if (!a) {
      const msg = [
        `🚨 <b>Severely Overdue</b>`,
        `👤 ${bill.name} | 🆔 ${bill.customer_id}`,
        `📞 ${bill.phone || 'No phone'} | 📍 ${bill.area || ''}`,
        `💰 ${taka(bill.amount)} due since ${bill.due_date} (<b>${bill.days_overdue} days</b>)`
      ].join('\n');
      await sendTelegram(msg);
      await logAlert('overdue_severe', bill.customer_id, msg);
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

async function checkDueSoon() {
  console.log('Checking bills due soon...');
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const future = new Date(today);
  future.setDate(future.getDate() + DUE_SOON_DAYS);
  const futureStr = future.toISOString().split('T')[0];

  const { data: bills, error } = await supabase
    .from('bills').select('id, customer_id, bill_month, amount, due_date')
    .in('status', ['unpaid', 'partial']).gte('due_date', todayStr).lte('due_date', futureStr);
  if (error) { console.error('Due soon error:', error.message); return; }
  if (!bills || bills.length === 0) { console.log('No bills due soon.'); return; }

  const alerted = await alreadyAlerted('due_soon_summary', 'SUMMARY');
  if (!alerted) {
    const customerIds = [...new Set(bills.map(b => b.customer_id))];
    const { data: customers } = await supabase.from('customers').select('customer_id, name').in('customer_id', customerIds);
    const custMap = {};
    (customers || []).forEach(c => custMap[c.customer_id] = c);
    const total = bills.reduce((s, b) => s + b.amount, 0);
    const msg = [
      `🟡 <b>SVCN — Bills Due Soon</b>`, ``,
      `📋 <b>${bills.length} bills</b> due within ${DUE_SOON_DAYS} days`,
      `💰 Total: <b>${taka(total)}</b>`, ``,
      ...bills.map(b => `• ${custMap[b.customer_id]?.name || b.customer_id} — ${taka(b.amount)} — due <b>${b.due_date}</b>`)
    ].join('\n');
    await sendTelegram(msg);
    await logAlert('due_soon_summary', 'SUMMARY', msg);
    console.log('Due soon alert sent.');
  }
}

async function sendDailySummary() {
  const alerted = await alreadyAlerted('daily_summary', 'SUMMARY');
  if (alerted) { console.log('Daily summary already sent today.'); return; }

  const today = new Date().toISOString().split('T')[0];
  const monthStart = today.slice(0, 7) + '-01';

  console.log('Today:', today, '| MonthStart:', monthStart);

  const r1 = await supabase.from('customers').select('*', { count: 'exact', head: true }).eq('status', 'active');
  const r2 = await supabase.from('bills').select('amount').in('status', ['unpaid','partial']).lt('due_date', today);
  const r3 = await supabase.from('bills').select('amount').in('status', ['unpaid','partial']).gte('due_date', today);
  const r4 = await supabase.from('payments').select('amount').gte('payment_date', monthStart);

  console.log('r1 customers count:', r1.count, 'error:', r1.error?.message);
  console.log('r2 overdue bills:', r2.data?.length, 'error:', r2.error?.message);
  console.log('r3 due soon:', r3.data?.length, 'error:', r3.error?.message);
  console.log('r4 payments:', r4.data?.length, 'sample:', JSON.stringify(r4.data?.slice(0,2)), 'error:', r4.error?.message);

  const activeCustomers = r1.count;
  const overdueBills    = r2.data || [];
  const dueSoonBills    = r3.data || [];
  const payments        = r4.data || [];

  const overdueAmount  = overdueBills.reduce((s, b) => s + b.amount, 0);
  const collectedMonth = payments.reduce((s, p) => s + p.amount, 0);

  const msg = [
    `📊 <b>SVCN Daily Summary</b>`,
    `📅 ${new Date().toLocaleDateString('en-BD', { weekday:'long', year:'numeric', month:'long', day:'numeric', timeZone:'Asia/Dhaka' })}`,
    ``, `👥 Active customers: <b>${activeCustomers ?? 0}</b>`,
    `🔴 Overdue bills: <b>${overdueBills.length}</b> (${taka(overdueAmount)})`,
    `🟡 Due soon: <b>${dueSoonBills.length}</b>`,
    `✅ Collected this month: <b>${taka(collectedMonth)}</b>`
  ].join('\n');

  await sendTelegram(msg);
  await logAlert('daily_summary', 'SUMMARY', msg);
  console.log('Daily summary sent.');
}

async function main() {
  console.log('=== SVCN Billing Alert Check ===');
  console.log('Time (BD):', new Date().toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' }));
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('Missing environment variables. Check your GitHub Secrets.');
    process.exit(1);
  }
  try {
    await checkOverdue();
    await checkDueSoon();
    await sendDailySummary();
    console.log('=== Done ===');
  } catch (err) {
    console.error('Fatal error:', err);
    await sendTelegram(`⚠️ <b>SVCN Alert Error</b>\n\n${err.message}`).catch(() => {});
    process.exit(1);
  }
}

main();
