# Job search bot

Runs every morning at 8am UK time (as a free GitHub Actions workflow --
no server needed), searches free job boards, scores the results against
your profile, and sends you the top 5 on Telegram.

**Looks for:** software engineering / cloud & network security roles, and
higher-education teaching roles (lecturer, teaching fellow, research
associate), filtered for remote/home-based and part-time/flexible hours.

**Sources:** Arbeitnow and RemoteOK (remote tech jobs, no key needed),
jobs.ac.uk (UK higher-education jobs, no key needed), and optionally Reed
(broad UK jobs, needs a free key, has an explicit part-time filter -- the
best direct match for a 20-hours-a-week cap).

## One-time setup (about 10 minutes)

### 1. Create a Telegram bot
1. In Telegram, message **@BotFather** → `/newbot` → follow the prompts.
2. It gives you a token like `123456:ABC-def...` -- copy it.
3. Message your new bot anything (so it can message you back), then open
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and
   find `"chat":{"id":...}` -- that number is your chat ID.

### 2. (Optional, recommended) Get a free Reed API key
Reed is the only source here with an explicit "part time only" filter.
Sign up at https://www.reed.co.uk/developers/jobseeker -- it's instant and free.

### 3. Add them as GitHub Actions secrets
In your repo: **Settings → Secrets and variables → Actions → New repository secret**
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `REED_API_KEY` (optional)

### 4. Test it
Go to the **Actions** tab → **Daily job search** → **Run workflow**. It
ignores the 8am time check when run this way, so you'll get a message
within a minute or two if everything's wired up.

## Tuning it

- Keywords and scoring live in `job_bot/search_jobs.py` (`KEYWORDS`,
  `REMOTE_WORDS`, `PART_TIME_WORDS`). Edit freely as your search evolves.
- Honest limits: academic teaching posts (PGTA/demonstrator roles
  especially) are often only advertised internally by your own university
  rather than on public job boards, so jobs.ac.uk may come up thin some
  days -- worth also checking your department's own postgrad/HR pages.
  Job-board keyword matching is noisy; always read the actual listing
  before relying on an hours/remote claim the bot made.
