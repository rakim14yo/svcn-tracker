/**
 * SVCN Billing Alerts — Main Alert Script
 * Runs via GitHub Actions twice daily
 * Checks: overdue payments, due-soon, and sends Telegram notifications
 */

import { createClient } from '@supabase/supabase-js';

// ─── Config ───────────────────────────────────────────────
const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TELEGRAM_BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID    = process.env.TELEGRAM_CHAT_ID;

// Alert thresholds
const OVERDUE_DAYS_THRESHOLD = 3;    // Alert after 3 days overdue
const DUE_SOON_DAYS          = 2;    // Alert 2 days before due date

// ─── Init Supabase ────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── Telegram Sender ──────────────────────────────────────
async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
    }),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error('Telegram error:', data);
  }
  return data.ok;
}

// ─── Alert Dedup Check ────────────────────────────────────
async function alreadyAlerted(alertType, customerId, billId) {
  // Don't send same alert more than once per day
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('alert_log')
    .select('id')
    .eq('alert_type', alertType)
    .eq('customer_id', customerId)
    .gte('sent_at', `${today}T00:00:00Z`)
    .limit(1);
  return data && data.length > 0;
}

async function logAlert(alertType, customerId, billId, message) {
  await supabase.from('alert_log').insert({
    alert_type: alertType,
    customer_id: customerId,
    bill_id: billId || null,
    message,
    channel: 'telegram',
  });
}

// ─── Format BDT ───────────────────────────────────────────
function taka(amount) {
  return `৳${amount.toLocaleString('en-BD')}`;
}

// ─── Check Overdue Payments ───────────────────────────────
async function checkOverdue() {
  console.log('Checking overdue payments...');

  const { data: bills, error } = await supabase
    .from('v_outstanding_bills')
    .select('*')
    .gt('days_overdue', OVERDUE_DAYS_THRESHOLD)
    .order('days_overdue', { ascending: false });

  if (error) { console.error('Overdue query error:', error); return 0; }
  if (!bills || bills.length === 0) {
    console.log('No overdue bills found.');
    return 0;
  }

  let alertsSent = 0;

  // Send a summary if there are many overdue bills
  if (bills.length > 3) {
    const totalOverdue = bills.reduce((sum, b) => sum + b.amount, 0);
    const alerted = await alreadyAlerted('overdue_summary', 'SUMMARY', null);
    if (!alerted) {
      const msg = [
        `🔴 <b>SVCN — Overdue Bills Summary</b>`,
        ``,
        `📊 <b>${bills.length} customers</b> are overdue`,
        `💸 Total outstanding: <b>${taka(totalOverdue)}</b>`,
        ``,
        `Top 5 overdue:`,
        ...bills.slice(0, 5).map(b =>
          `• ${b.name} (${b.customer_id}) — ${taka(b.amount)} — <b>${b.days_overdue} days</b>`
        ),
        ``,
        `📅 ${new Date().toLocaleDateString('en-BD', { timeZone: 'Asia/Dhaka' })}`,
      ].join('\n');

      await sendTelegram(msg);
      await logAlert('overdue_summary', 'SUMMARY', null, msg);
      alertsSent++;
    }
  }

  // Individual alerts for severely overdue (>7 days)
  for (const bill of bills.filter(b => b.days_overdue > 7)) {
    const alerted = await alreadyAlerted('overdue_severe', bill.customer_id, bill.bill_id);
    if (!alerted) {
      const msg = [
        `🚨 <b>Severely Overdue — Action Needed</b>`,
        ``,
        `👤 ${bill.name}`,
        `🆔 ${bill.customer_id}`,
        `📞 ${bill.phone || 'No phone'}`,
        `📍 ${bill.area || ''}`,
        `🌐 ${bill.package_mbps}Mbps — ${taka(bill.package_price)}/month`,
        ``,
        `💰 Bill: ${taka(bill.amount)} (${bill.bill_month})`,
        `📅 Due: ${bill.due_date} (<b>${bill.days_overdue} days overdue</b>)`,
      ].join('\n');

      await sendTelegram(msg);
      await logAlert('overdue_severe', bill.customer_id, bill.bill_id, msg);
      alertsSent++;

      // Rate limit: don't spam, max 1 msg per 500ms
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`Overdue check: sent ${alertsSent} alerts`);
  return alertsSent;
}

// ─── Check Due Soon ────────────────────────────────────────
async function checkDueSoon() {
  console.log('Checking bills due soon...');

  const today = new Date().toISOString().split('T')[0];
  const futureCutoff = new Date();
  futureCutoff.setDate(futureCutoff.getDate() + DUE_SOON_DAYS);
  const futureStr = futureCutoff.toISOString().split('T')[0];

  const { data: bills, error } = await supabase
    .from('v_outstanding_bills')
    .select('*')
    .gte('due_date', today)
    .lte('due_date', futureStr);

  if (error) { console.error('Due soon query error:', error); return 0; }
  if (!bills || bills.length === 0) {
    console.log('No bills due soon.');
    return 0;
  }

  const alerted = await alreadyAlerted('due_soon_summary', 'SUMMARY', null);
  if (!alerted) {
    const totalDue = bills.reduce((sum, b) => sum + b.amount, 0);
    const msg = [
      `🟡 <b>SVCN — Bills Due Soon</b>`,
      ``,
      `📋 <b>${bills.length} bills</b> due within ${DUE_SOON_DAYS} days`,
      `💰 Total: <b>${taka(totalDue)}</b>`,
      ``,
      ...bills.map(b =>
        `• ${b.name} — ${taka(b.amount)} — due <b>${b.due_date}</b>`
      ),
    ].join('\n');

    await sendTelegram(msg);
    await logAlert('due_soon_summary', 'SUMMARY', null, msg);
    console.log('Due soon alert sent');
    return 1;
  }
  return 0;
}

// ─── Daily Summary ────────────────────────────────────────
async function sendDailySummary() {
  const { data: stats } = await supabase
    .from('v_dashboard_stats')
    .select('*')
    .single();

  if (!stats) return;

  const alerted = await alreadyAlerted('daily_summary', 'SUMMARY', null);
  if (alerted) return;

  const msg = [
    `📊 <b>SVCN Daily Summary</b>`,
    `📅 ${new Date().toLocaleDateString('en-BD', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Dhaka' })}`,
    ``,
    `👥 Active customers: <b>${stats.active_customers}</b>`,
    `🔴 Overdue bills: <b>${stats.overdue_count}</b> (${taka(stats.overdue_amount || 0)})`,
    `🟡 Due in 3 days: <b>${stats.due_soon_count}</b>`,
    `✅ Collected this month: <b>${taka(stats.collected_this_month || 0)}</b>`,
  ].join('\n');

  await sendTelegram(msg);
  await logAlert('daily_summary', 'SUMMARY', null, msg);
  console.log('Daily summary sent');
}

// ─── Main ─────────────────────────────────────────────────
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
    // Try to send error alert to Telegram
    await sendTelegram(`⚠️ <b>SVCN Alert Script Error</b>\n\n${err.message}`).catch(() => {});
    process.exit(1);
  }
}

main();
