# Job alerts service

A public website where anyone can sign up with their email and the jobs they
want (job titles/skills, country, remote only, experience level). Every
morning it searches job boards for each person, keeps the best new matches
that pass its checks, and emails them up to 5. Nobody gets the same job twice.

- **Sign-up site**: runs on Cloudflare from `job_alerts_worker/` (see its README). `app.py` is the
  same site in Python, kept for local development and the original Render setup (`render.yaml`).
- **Python sign-up site** (`app.py`): sign up, confirm by email, change preferences,
  one-click unsubscribe (which deletes their details).
- **Daily sender** (`send_daily.py`): run by the GitHub Actions workflow
  `job_alerts_daily.yml` at 6:00 UTC.
- **Search** (`search.py`): remote jobs from Himalayas, Jobicy and Remotive
  (no keys needed). On-site jobs need free Adzuna keys (19 countries) and/or a
  Reed key (UK).

Every job sent has passed these checks: the location fits the person, it was
posted in the last 3 weeks, the seniority fits, it's paid (no volunteer or
commission-only roles), it shows no common scam signs, it isn't past the
board's expiry date, and its link doesn't come back "not found".

## Going live (all free tiers, about 20 minutes)

1. **Database: Neon** (neon.tech). Create a project in the **AWS Europe (London)** region and copy its connection
   string (`postgresql://...`). This is `DATABASE_URL`.
2. **Email: Brevo** (brevo.com, 300 emails/day free). Verify a sender address,
   then under SMTP & API copy the SMTP login and key. Use `SMTP_HOST=smtp-relay.brevo.com`,
   `SMTP_PORT=587`, `SMTP_USER` = the login, `SMTP_PASSWORD` = the key, and
   `FROM_EMAIL` = your verified sender. Don't use a personal Gmail for real
   users: Gmail caps sending and flags bulk mail to strangers.
3. **Website: Render** (render.com). New → Blueprint → pick this repo; it reads
   `render.yaml`. Fill in the environment variables from steps 1 and 2. Render's
   free plan blocks outgoing SMTP, so also set `BREVO_API_KEY` (Brevo → SMTP & API
   → API Keys); the site then sends through Brevo's web API. Once
   it's live, set `BASE_URL` to the site's address (e.g. `https://job-alerts.onrender.com`).
   The free plan sleeps when idle, so the first visit after a while takes ~30s.
4. **Payments: Credo or Paystack.** One payment of `PRICE_NGN` (default 5000)
   buys `PERIOD_DAYS` (default 90) of alerts; nothing renews automatically, and
   subscribers get a renew link by email 5 days before it ends. In Render set either
   - Credo (credocentral.com): `CREDO_PUBLIC_KEY`, `CREDO_SECRET_KEY` (Settings →
     Developer → API Keys) and `CREDO_LIVE=1` once you use the live keys (without it
     the site talks to the sandbox); webhook in Settings → Webhooks; or
   - Paystack: `PAYSTACK_SECRET_KEY`; webhook in Settings → API Keys & Webhooks.

   Webhook URL for either: `<BASE_URL>/payments/webhook`. Also set `CONTACT_EMAIL`
   (shown on the terms page). Without keys the site is free and `/pay` is off. The
   daily sender only emails people who have paid; set `REQUIRE_PAYMENT=0` in the
   workflow to send to everyone confirmed.
5. **Daily emails: GitHub** → Settings → Secrets and variables → Actions. Add
   `JOB_ALERTS_DATABASE_URL`, `JOB_ALERTS_BASE_URL`, `SMTP_HOST`, `SMTP_PORT`,
   `SMTP_USER`, `SMTP_PASSWORD`, `FROM_EMAIL`, and optionally `ADZUNA_APP_ID`,
   `ADZUNA_APP_KEY`, `REED_API_KEY`. On-site/hybrid alerts need the Adzuna key
   (free at developer.adzuna.com); without it those subscribers get remote jobs only.
6. Sign up on your own site, confirm, then run **Job alerts -- daily emails to
   subscribers** from the Actions tab to get your first email.

## Running it locally

```
pip install -r job_alerts/requirements.txt
SMTP_USER=you@gmail.com SMTP_PASSWORD=<app password> uvicorn job_alerts.app:app --reload
BASE_URL=http://127.0.0.1:8000 SMTP_USER=... SMTP_PASSWORD=... python -m job_alerts.send_daily
```
Without `DATABASE_URL` it uses a local `job_alerts.db` SQLite file.

## Limits worth knowing

- Free email tiers cap volume (Brevo: 300/day), so that's ~300 subscribers
  before you need a paid plan.
- Job boards' free APIs ask for modest use. Searches are shared between
  subscribers with the same keywords, but with many subscribers you'll want
  paid/partner API access.
