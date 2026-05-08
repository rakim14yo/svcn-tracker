# 🛰️ SVCN Billing Alerts System

**Zero-cost, self-deployable billing dashboard + automated Telegram alert system for Satellite Vision Cable Network.**

| Feature | Details |
|---|---|
| **Dashboard** | GitHub Pages (free) — live view of all bills, customers, payments |
| **Database** | Supabase free tier — 500MB, REST API, real-time |
| **Alerts** | GitHub Actions cron (free) → Telegram Bot → your phone |
| **Cost** | ৳0 forever (within free tier limits) |
| **Capacity** | 100–1,000 customers comfortably |

---

## ⚡ Quick Deploy (< 30 minutes)

### Step 1 — Fork this repo

Click **Fork** on GitHub. Your repo will be at:
`https://github.com/YOUR_USERNAME/svcn-billing-alerts`

---

### Step 2 — Create Supabase Database (free)

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Name: `svcn-billing` | Password: (save this) | Region: **Singapore** (closest to BD)
3. Wait ~2 minutes for project to spin up
4. Go to **SQL Editor** → paste the entire contents of `supabase/schema.sql` → **Run**
5. Go to **Project Settings → API**:
   - Copy **Project URL** → save as `SUPABASE_URL`
   - Copy **anon (public) key** → save as `SUPABASE_ANON_KEY`
   - Copy **service_role (secret) key** → save as `SUPABASE_SERVICE_KEY`

---

### Step 3 — Create Telegram Bot (free, 5 minutes)

1. Open Telegram → search **@BotFather** → `/start`
2. Send `/newbot` → enter name: `SVCN Alerts` → username: `svcn_alerts_bot` (or any unique name)
3. BotFather sends you a token like `7123456789:AAFxxx...` → save as `TELEGRAM_BOT_TOKEN`
4. Send any message to your new bot (start the chat)
5. Open this URL in browser (replace YOUR_TOKEN):
   ```
   https://api.telegram.org/botYOUR_TOKEN/getUpdates
   ```
6. Find `"id"` inside `"chat"` in the response → save as `TELEGRAM_CHAT_ID`

---

### Step 4 — Add GitHub Secrets

In your forked repo → **Settings → Secrets and variables → Actions → New repository secret**

Add these 4 secrets:

| Secret Name | Value |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Your Supabase **service_role** key (NOT anon key) |
| `TELEGRAM_BOT_TOKEN` | Your bot token from BotFather |
| `TELEGRAM_CHAT_ID` | Your Telegram chat/user ID |

---

### Step 5 — Configure Dashboard

Edit `dashboard/index.html` — find these two lines near the bottom:

```javascript
const SUPABASE_URL      = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

Replace with your actual values. Commit and push.

---

### Step 6 — Enable GitHub Pages

In your repo → **Settings → Pages**:
- Source: **Deploy from a branch**
- Branch: `main` | Folder: `/dashboard`
- Click Save

Your dashboard will be live at:
`https://YOUR_USERNAME.github.io/svcn-billing-alerts/`

---

### Step 7 — Test the alert system

Go to **Actions** tab → **SVCN Billing Alerts** → **Run workflow** → Run

Check your Telegram — you should receive a daily summary message!

---

## 🔔 What Alerts You'll Receive

| Alert | Trigger | Frequency |
|---|---|---|
| 🔴 **Overdue Summary** | >3 days past due | Once/day |
| 🚨 **Severely Overdue** | >7 days past due (individual) | Once/day |
| 🟡 **Due Soon** | 2 days before due date | Once/day |
| 📊 **Daily Summary** | Always | 9 AM BD time |
| 🧾 **Bills Generated** | 1st of every month | Monthly |

---

## 📦 Package Reference

| Speed | Monthly Price | Connection |
|---|---|---|
| 20 Mbps | ৳500 | WiFi |
| 35 Mbps | ৳650 | WiFi |
| 50 Mbps | ৳800 | WiFi |
| 65 Mbps | ৳950 | WiFi |
| 80 Mbps | ৳1100 | WiFi |
| Dish TV Cable | ৳350 | Cable |
| Dish TV STB | ৳500 | Set-top Box |
| Combo | ৳1050 | WiFi + Dish |

---

## 🗂️ Project Structure

```
svcn-billing-alerts/
├── .github/
│   └── workflows/
│       └── billing-alerts.yml   ← GitHub Actions cron job
├── dashboard/
│   ├── index.html               ← GitHub Pages dashboard
│   └── _config.yml
├── scripts/
│   ├── package.json
│   ├── billing-alerts.js        ← Overdue/due-soon checker
│   └── generate-bills.js        ← Monthly bill auto-generator
├── supabase/
│   └── schema.sql               ← Run this in Supabase SQL Editor
└── README.md
```

---

## 🧰 Day-to-Day Usage

### Adding a new customer
Open your dashboard → **+ Customer** button → fill form → save.
Bills auto-generate on the 1st of each month.

### Recording a payment
Dashboard → **+ Payment** → select customer → select bill → amount → method.
Bill status automatically updates to "paid".

### Manual bill generation (if needed)
Actions tab → **SVCN Billing Alerts** → Run workflow.
Or set `FORCE_GENERATE=true` in the workflow environment.

### Checking overdue customers
Dashboard → **Outstanding Bills** tab → click **🔴 Overdue** filter.

---

## ⚙️ Customization

### Change alert schedule
Edit `.github/workflows/billing-alerts.yml`:
```yaml
- cron: '0 3 * * *'   # 9 AM Bangladesh Time (UTC+6)
- cron: '0 9 * * *'   # 3 PM Bangladesh Time
```

### Change overdue threshold
Edit `scripts/billing-alerts.js`:
```javascript
const OVERDUE_DAYS_THRESHOLD = 3;  // Alert after X days overdue
const DUE_SOON_DAYS          = 2;  // Alert X days before due date
```

### Change bill due date
Edit `scripts/generate-bills.js`:
```javascript
const dueDate = `${year}-${month}-10`;  // Change 10 to your preferred due day
```

---

## 📞 SVCN Contact Info
- **Phone**: 01842292646 / 01634348602
- **Email**: satellitevisioncablenetwork@gmail.com

---

## 🆓 Free Tier Limits

| Service | Free Limit | Your Usage (1000 customers) |
|---|---|---|
| Supabase DB | 500 MB | ~10 MB |
| Supabase API | 5M requests/month | ~3K/month |
| GitHub Actions | 2,000 min/month | ~60 min/month |
| Telegram Bot | Unlimited | ✅ |
| GitHub Pages | Unlimited | ✅ |

You are **well within** all free tier limits with up to 1,000 customers.
