"""Entry point run every Monday by .github/workflows/weekly_remote_jobs.yml.

Emails the 5 best verified remote PR / PA jobs open to someone in Nigeria.
Required secrets: EMAIL_USER, EMAIL_APP_PASSWORD, EMAIL_TO (see job_bot/README.md).
Stops sending after LAST_SEND_DATE, so it runs for one month and then goes quiet.
"""
import os
import sys
from datetime import date, datetime
from zoneinfo import ZoneInfo

from email_notify import format_html, format_text, send_email
from nigeria_remote_jobs import find_top_jobs

LAST_SEND_DATE = date(2026, 11, 9)  # 4 Mondays: 19 Oct, 26 Oct, 2 Nov, 9 Nov 2026
HEADING = "Remote PR & PA jobs open to Nigeria"


def main() -> None:
    now = datetime.now(ZoneInfo("Africa/Lagos"))
    forced = os.environ.get("FORCE_RUN") == "1"
    if not forced and now.date() > LAST_SEND_DATE:
        print(f"Finished: the last weekly email was due on {LAST_SEND_DATE:%d %b %Y}. Delete this workflow when ready.")
        return

    jobs = find_top_jobs()
    for j in jobs:
        print(f"- {j['title']} | {j['company']} | {', '.join(j['matched'])} | {j['url']}")
    if os.environ.get("DRY_RUN") == "1":
        print(f"Dry run: found {len(jobs)} job(s), no email sent.")
        return

    user, password = os.environ.get("EMAIL_USER"), os.environ.get("EMAIL_APP_PASSWORD")
    to = os.environ.get("EMAIL_TO") or user
    if not (user and password):
        print("Missing EMAIL_USER / EMAIL_APP_PASSWORD -- add them as repo secrets.", file=sys.stderr)
        sys.exit(1)
    send_email(
        user, password, to,
        subject=f"{HEADING} -- week of {now:%d %b}",
        text=format_text(jobs, now, HEADING),
        html=format_html(jobs, now, HEADING),
        host=os.environ.get("EMAIL_SMTP_HOST") or "smtp.gmail.com",
    )
    print(f"Emailed {len(jobs)} job(s) to {to}.")


if __name__ == "__main__":
    main()
