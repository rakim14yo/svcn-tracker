/**
 * SVCN Auto Bill Generator
 * Runs on the 1st of each month via GitHub Actions
 * Creates bills for all active customers based on their package price
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TELEGRAM_BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID     = process.env.TELEGRAM_CHAT_ID;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' }),
  });
}

function taka(n) { return `৳${n.toLocaleString('en-BD')}`; }

async function generateMonthlyBills() {
  const now = new Date();
  const isFirstOfMonth = now.getDate() === 1;

  // Safety check — only run on 1st of month (or forced via workflow_dispatch)
  if (!isFirstOfMonth && process.env.FORCE_GENERATE !== 'true') {
    console.log(`Today is the ${now.getDate()}th — bill generation skipped (runs on 1st only).`);
    return;
  }

  // Calculate bill month (current month in YYYY-MM format)
  const billMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Due date = 10th of current month
  const dueDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-10`;

  console.log(`Generating bills for ${billMonth}, due ${dueDate}...`);

  // Get all active customers
  const { data: customers, error: custError } = await supabase
    .from('customers')
    .select('customer_id, name, package_price, package_mbps, connection_type')
    .eq('status', 'active');

  if (custError || !customers) {
    console.error('Failed to fetch customers:', custError);
    return;
  }

  let created = 0;
  let skipped = 0;
  let totalAmount = 0;

  for (const customer of customers) {
    // Determine bill amount based on connection type
    let amount = customer.package_price;
    if (customer.connection_type === 'dish_cable') amount = 350;
    else if (customer.connection_type === 'dish_stb') amount = 500;
    else if (customer.connection_type === 'combo') amount = 1050;

    // Insert bill (skip if already exists for this month)
    const { error } = await supabase.from('bills').insert({
      customer_id: customer.customer_id,
      bill_month: billMonth,
      amount,
      due_date: dueDate,
      issued_date: now.toISOString().split('T')[0],
      status: 'unpaid',
    });

    if (error) {
      if (error.code === '23505') { // unique constraint — bill already exists
        skipped++;
      } else {
        console.error(`Bill creation failed for ${customer.customer_id}:`, error.message);
      }
    } else {
      created++;
      totalAmount += amount;
    }
  }

  console.log(`Bills generated: ${created} new, ${skipped} skipped`);

  // Notify via Telegram
  const monthName = now.toLocaleDateString('en-BD', { month: 'long', year: 'numeric', timeZone: 'Asia/Dhaka' });
  await sendTelegram([
    `🧾 <b>SVCN — Monthly Bills Generated</b>`,
    ``,
    `📅 Period: <b>${monthName}</b>`,
    `📆 Due Date: <b>${dueDate}</b>`,
    ``,
    `✅ New bills created: <b>${created}</b>`,
    `💰 Total invoiced: <b>${taka(totalAmount)}</b>`,
    skipped > 0 ? `⏭ Already existed: ${skipped}` : '',
  ].filter(Boolean).join('\n'));
}

async function main() {
  console.log('=== SVCN Bill Generator ===');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing Supabase credentials');
    process.exit(1);
  }
  try {
    await generateMonthlyBills();
    console.log('=== Done ===');
  } catch (err) {
    console.error('Fatal:', err);
    await sendTelegram(`⚠️ Bill generation failed: ${err.message}`).catch(() => {});
    process.exit(1);
  }
}

main();
