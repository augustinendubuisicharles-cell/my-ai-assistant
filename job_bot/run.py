"""Entry point run daily by .github/workflows/job_search.yml.

Required secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (see job_bot/README.md).
Optional secret: REED_API_KEY -- adds Reed's UK jobs with an explicit part-time filter.
"""
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

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
    if not token or not chat_id:
        print("Missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID -- add them as repo secrets.", file=sys.stderr)
        sys.exit(1)

    now_uk = datetime.now(ZoneInfo("Europe/London"))
    # Two cron triggers cover both GMT and BST; only the one that's actually ~8am
    # UK time should send, so a change of season doesn't double-message you.
    if os.environ.get("FORCE_RUN") != "1" and now_uk.hour != 8:
        print(f"Skipping: {now_uk:%H:%M} UK time, not the 8am run.")
        return

    jobs = find_top_jobs(reed_api_key=os.environ.get("REED_API_KEY"))
    send_message(token, chat_id, format_message(jobs, now_uk))
    print(f"Sent {len(jobs)} job(s) to Telegram.")


if __name__ == "__main__":
    main()
