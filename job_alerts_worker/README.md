# Job alerts website on Cloudflare

The sign-up website (form, confirm, manage, unsubscribe, payments, terms) as a
Cloudflare Worker. It replaces running `job_alerts/app.py` on Render, because
Workers don't go to sleep. It uses the same Neon database; the tables are
created by `job_alerts/db.py`, and the daily job search and emails still run from
GitHub Actions (`job_alerts/send_daily.py`).

## One-time setup

1. Create a free Cloudflare account at dash.cloudflare.com.
2. **Account ID:** on the dashboard home, open the menu next to your account
   name, or Workers & Pages → the right-hand panel, and copy the Account ID.
3. **API token:** My Profile → API Tokens → Create Token → use the
   **Edit Cloudflare Workers** template → Create, and copy the token.
4. In GitHub → Settings → Secrets and variables → Actions, add
   `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, plus the site's settings:
   `BREVO_API_KEY`, `CONTACT_EMAIL`, and the payment keys (`CREDO_PUBLIC_KEY`,
   `CREDO_SECRET_KEY`, and `CREDO_LIVE=1` for real money; or `PAYSTACK_SECRET_KEY`).
   `JOB_ALERTS_DATABASE_URL` and `FROM_EMAIL` are already there.
5. Run **Job alerts -- website on Cloudflare** from the Actions tab (it also runs
   on every merge that changes the site). The log prints the address, e.g.
   `https://job-alerts.<your-subdomain>.workers.dev`.
6. Set GitHub's `JOB_ALERTS_BASE_URL` secret to that address (the daily emails
   link to it), and set the payment webhook to `<address>/payments/webhook`.

Changing a secret in GitHub only reaches the site on the next deploy, so re-run
the workflow after changing one.

## Paid members

Paying members (not trial users) get up to 10 jobs a day across all 5 of their
job titles (the trial gets 5 jobs from the first 2) and can connect Telegram.

Telegram alerts: create a bot with @BotFather, save its token as the GitHub
secret `JOB_ALERTS_TELEGRAM_TOKEN`, make sure `JOB_ALERTS_BASE_URL` is set, and
re-run this workflow. It points the bot at `<site>/telegram/webhook`. Members
then see "Connect Telegram" on their manage page, and
`.github/workflows/job_alerts_telegram.yml` sends them up to 3 new matches four
times a day.

## Develop

```
cd job_alerts_worker
npm install
npm test        # runs the site against an in-memory Postgres with the real schema
npm run check   # bundles it the way Cloudflare will
```
