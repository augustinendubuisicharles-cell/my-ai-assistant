# Job search bot

Runs every morning at 8am UK time (as a free GitHub Actions workflow --
no server needed), searches free job boards, scores the results against
your profile, and sends you the top 5 by email (and/or Telegram).

**Looks for:** software engineering / cloud & network security roles, and
higher-education teaching roles (lecturer, teaching fellow, research
associate), filtered for remote/home-based and part-time/flexible hours.

**Sources:** Arbeitnow and RemoteOK (remote tech jobs, no key needed),
jobs.ac.uk (UK higher-education jobs, no key needed), and optionally Reed
(broad UK jobs, needs a free key, has an explicit part-time filter -- the
best direct match for a 20-hours-a-week cap).

## One-time setup (about 5 minutes)

### 1. Choose where the digest goes

**Email (easiest, recommended).** Works with any inbox. Uses a Gmail
account to send.
1. Turn on 2-Step Verification for the Gmail account if it isn't already.
2. Open https://myaccount.google.com/apppasswords, create an app password
   named "job bot", and copy the 16-character code.
3. You'll add these as secrets in step 3:
   - `EMAIL_USER`: the Gmail address, e.g. `you@gmail.com`
   - `EMAIL_APP_PASSWORD`: the 16-character code
   - `EMAIL_TO` (optional): where to send it, if not the same address.
     Several addresses can be comma-separated.

   Not using Gmail? Also add `EMAIL_SMTP_HOST` with your provider's SSL
   (port 465) server, e.g. `smtp.mail.yahoo.com`.

**Telegram (optional).** If you also want it on your phone as a chat:
1. In Telegram, message **@BotFather** → `/newbot` → follow the prompts.
2. It gives you a token like `123456:ABC-def...` -- copy it.
3. Message your new bot anything (so it can message you back), then open
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and
   find `"chat":{"id":...}` -- that number is your chat ID.

If both are set up, you get both.

### 2. (Optional, recommended) Get a free Reed API key
Reed is the only source here with an explicit "part time only" filter.
Sign up at https://www.reed.co.uk/developers/jobseeker -- it's instant and free.

### 3. Add them as GitHub Actions secrets
In your repo: **Settings → Secrets and variables → Actions → New repository secret**
- `EMAIL_USER`, `EMAIL_APP_PASSWORD`, `EMAIL_TO` (optional) -- for email
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` -- for Telegram
- `REED_API_KEY` (optional)

### 4. Test it
Go to the **Actions** tab → **Daily job search** → **Run workflow**. It
ignores the 8am time check when run this way, so you'll get the email
or message within a minute or two if everything's wired up.

## Tuning it

- Keywords and scoring live in `job_bot/search_jobs.py` (`KEYWORDS`,
  `REMOTE_WORDS`, `PART_TIME_WORDS`). Edit freely as your search evolves.
- Honest limits: academic teaching posts (PGTA/demonstrator roles
  especially) are often only advertised internally by your own university
  rather than on public job boards, so jobs.ac.uk may come up thin some
  days -- worth also checking your department's own postgrad/HR pages.
  Job-board keyword matching is noisy; always read the actual listing
  before relying on an hours/remote claim the bot made.

## Weekly remote PR & PA jobs (Nigeria) -- email

A second, separate search (`run_weekly.py`, workflow **Weekly remote PR &
PA jobs (Nigeria)**) runs every Monday at 8am Lagos time and emails the 5
best remote PR/communications and PA/virtual-assistant jobs that someone
living in Nigeria can apply for. It uses the `EMAIL_*` secrets above and
stops by itself after Monday 9 Nov 2026 (`LAST_SEND_DATE` in
`run_weekly.py`). Change that date to keep it going.

Sources: Himalayas, Jobicy and Remotive (no keys needed). Every job sent
has passed these checks: open to Nigeria (worldwide, Africa, EMEA or
Nigeria), posted in the last 3 weeks, not a senior/manager role, paid
(no volunteer or commission-only roles), no common scam signs (fees,
Telegram/WhatsApp interviews), not past the board's expiry date, and its
link doesn't come back "not found" or say the job has closed.

To preview it: Actions tab → **Weekly remote PR & PA jobs (Nigeria)** →
**Run workflow**. "Dry run" is ticked by default, which only prints the
jobs in the log; untick it to send the email.

The daily UK search above sends to Telegram only.
