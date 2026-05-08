-- ============================================================
-- SVCN Billing Alerts — Supabase Schema
-- Run this in your Supabase SQL Editor (once)
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────
-- CUSTOMERS
-- ─────────────────────────────────────────
create table if not exists customers (
  id            uuid primary key default gen_random_uuid(),
  customer_id   text unique not null,          -- e.g. SVCN-0001
  name          text not null,
  phone         text,                           -- 01XXXXXXXXX
  address       text,
  area          text,                           -- e.g. Nasirabad Block-A
  package_mbps  integer not null,               -- 20,35,50,65,80
  package_price integer not null,               -- 500,650,800,950,1100
  connection_type text default 'wifi',          -- wifi | dish_cable | dish_stb | combo
  status        text default 'active',          -- active | suspended | disconnected
  join_date     date default current_date,
  notes         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ─────────────────────────────────────────
-- BILLS
-- ─────────────────────────────────────────
create table if not exists bills (
  id            uuid primary key default gen_random_uuid(),
  customer_id   text not null references customers(customer_id) on delete cascade,
  bill_month    text not null,                  -- e.g. "2025-05"
  amount        integer not null,               -- in BDT
  due_date      date not null,
  issued_date   date default current_date,
  status        text default 'unpaid',          -- unpaid | paid | partial | waived
  notes         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique(customer_id, bill_month)
);

-- ─────────────────────────────────────────
-- PAYMENTS
-- ─────────────────────────────────────────
create table if not exists payments (
  id            uuid primary key default gen_random_uuid(),
  customer_id   text not null references customers(customer_id) on delete cascade,
  bill_id       uuid references bills(id) on delete set null,
  amount        integer not null,
  payment_date  date default current_date,
  method        text default 'cash',            -- cash | bkash | nagad | rocket
  received_by   text,
  reference     text,                           -- bKash TrxID etc.
  notes         text,
  created_at    timestamptz default now()
);

-- ─────────────────────────────────────────
-- ALERT LOG (prevent duplicate alerts)
-- ─────────────────────────────────────────
create table if not exists alert_log (
  id            uuid primary key default gen_random_uuid(),
  alert_type    text not null,                  -- overdue | due_soon | payment_received | new_bill
  customer_id   text,
  bill_id       uuid,
  message       text,
  sent_at       timestamptz default now(),
  channel       text default 'telegram'         -- telegram | email | sms
);

-- ─────────────────────────────────────────
-- VIEWS (used by dashboard)
-- ─────────────────────────────────────────

-- Outstanding bills with customer info
create or replace view v_outstanding_bills as
select
  b.id as bill_id,
  b.customer_id,
  c.name,
  c.phone,
  c.area,
  c.package_mbps,
  c.package_price,
  b.bill_month,
  b.amount,
  b.due_date,
  b.issued_date,
  b.status,
  current_date - b.due_date as days_overdue
from bills b
join customers c on c.customer_id = b.customer_id
where b.status in ('unpaid', 'partial')
  and c.status = 'active'
order by b.due_date asc;

-- Monthly revenue summary
create or replace view v_monthly_revenue as
select
  date_trunc('month', payment_date) as month,
  count(*) as payment_count,
  sum(amount) as total_collected
from payments
group by 1
order by 1 desc;

-- Dashboard stats snapshot
create or replace view v_dashboard_stats as
select
  (select count(*) from customers where status = 'active') as active_customers,
  (select count(*) from bills where status in ('unpaid','partial') and due_date < current_date) as overdue_count,
  (select coalesce(sum(amount),0) from bills where status in ('unpaid','partial') and due_date < current_date) as overdue_amount,
  (select count(*) from bills where status in ('unpaid','partial') and due_date between current_date and current_date + 3) as due_soon_count,
  (select coalesce(sum(amount),0) from payments where payment_date >= date_trunc('month', current_date)) as collected_this_month;

-- ─────────────────────────────────────────
-- ROW LEVEL SECURITY (important!)
-- ─────────────────────────────────────────
alter table customers enable row level security;
alter table bills enable row level security;
alter table payments enable row level security;
alter table alert_log enable row level security;

-- Public read-only (dashboard reads with anon key — safe, no PII edits)
create policy "Public read customers" on customers for select using (true);
create policy "Public read bills"     on bills     for select using (true);
create policy "Public read payments"  on payments  for select using (true);
create policy "Public read alert_log" on alert_log for select using (true);

-- Only service_role (GitHub Actions) can write
create policy "Service write customers" on customers for all using (auth.role() = 'service_role');
create policy "Service write bills"     on bills     for all using (auth.role() = 'service_role');
create policy "Service write payments"  on payments  for all using (auth.role() = 'service_role');
create policy "Service write alert_log" on alert_log for all using (auth.role() = 'service_role');

-- ─────────────────────────────────────────
-- SAMPLE DATA (delete after testing)
-- ─────────────────────────────────────────
insert into customers (customer_id, name, phone, area, package_mbps, package_price) values
  ('SVCN-0001', 'Mohammad Hasan', '01712345678', 'Nasirabad Block-A', 35, 650),
  ('SVCN-0002', 'Fatema Begum',   '01812345679', 'Nasirabad Block-B', 20, 500),
  ('SVCN-0003', 'Karim Uddin',    '01912345680', 'Nasirabad Block-C', 50, 800)
on conflict do nothing;

insert into bills (customer_id, bill_month, amount, due_date, status) values
  ('SVCN-0001', '2025-05', 650, current_date - 5, 'unpaid'),
  ('SVCN-0002', '2025-05', 500, current_date + 2, 'unpaid'),
  ('SVCN-0003', '2025-05', 800, current_date - 1, 'unpaid')
on conflict do nothing;
