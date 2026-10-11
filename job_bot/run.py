"""Entry point run daily by .github/workflows/job_search.yml.

Delivery (set up at least one -- see job_bot/README.md):
  Email:    EMAIL_USER, EMAIL_APP_PASSWORD, optional EMAIL_TO (defaults to EMAIL_USER)
  Telegram: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
Optional secret: REED_API_KEY -- adds Reed's UK jobs with an explicit part-time filter.
"""
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from email_notify import format_html, format_text, send_email
from search_jobs import find_top_jobs
from telegram_notify import send_message


def format_message(jobs: list[dict], today) -> str:
    header = f"*Your top opportunities -- {today:%a %d %b}*\n"
    if not jobs:
        return header + (
            "\nNo strong matches today (nothing hit both a keyword and a remote/part-time "
            "signal). Add REED_API_KEY for broader UK coverage, or widen the search terms "
            "in job_bot/search_jobs.py."
        )
    lines = [header]
    for i, j in enumerate(jobs, 1):
        why = ", ".join(j["matched"]) or "keyword match"
        where = f" -- {j['location']}" if j["location"] else ""
        company = f" at *{j['company']}*" if j["company"] else ""
        lines.append(
            f"\n{i}. *{j['title']}*{company}{where}\n"
            f"   _{why}_ (via {j['source']})\n"
            f"   {j['url']}"
        )
    lines.append("\n\n_Always verify visa/work-hours terms on the listing itself before applying._")
    return "\n".join(lines)


def main() -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    email_user = os.environ.get("EMAIL_USER")
    email_password = os.environ.get("EMAIL_APP_PASSWORD")
    email_to = os.environ.get("EMAIL_TO") or email_user
    use_telegram = bool(token and chat_id)
    use_email = bool(email_user and email_password)
    if not (use_telegram or use_email):
        print(
            "No delivery set up -- add EMAIL_USER + EMAIL_APP_PASSWORD (or TELEGRAM_BOT_TOKEN + "
            "TELEGRAM_CHAT_ID) as repo secrets. See job_bot/README.md.",
            file=sys.stderr,
        )
        sys.exit(1)

    now_uk = datetime.now(ZoneInfo("Europe/London"))
    # Two cron triggers cover both GMT and BST; only the one that's actually ~8am
    # UK time should send, so a change of season doesn't double-message you.
    if os.environ.get("FORCE_RUN") != "1" and now_uk.hour != 8:
        print(f"Skipping: {now_uk:%H:%M} UK time, not the 8am run.")
        return

    jobs = find_top_jobs(reed_api_key=os.environ.get("REED_API_KEY"))
    if use_email:
        send_email(
            email_user, email_password, email_to,
            subject=f"Your top job matches -- {now_uk:%a %d %b}",
            text=format_text(jobs, now_uk),
            html=format_html(jobs, now_uk),
            host=os.environ.get("EMAIL_SMTP_HOST") or "smtp.gmail.com",
        )
        print(f"Emailed {len(jobs)} job(s) to {email_to}.")
    if use_telegram:
        send_message(token, chat_id, format_message(jobs, now_uk))
        print(f"Sent {len(jobs)} job(s) to Telegram.")

if __name__ == "__main__":
    main()
