"""Run a few times a day (by .github/workflows/job_alerts_telegram.yml): sends paying members who
connected Telegram any new matches straight away, so they can apply before the morning email.
Jobs sent here are remembered, so the morning email won't repeat them.

Run from the repo root:  python -m job_alerts.send_telegram
Needs DATABASE_URL and JOB_ALERTS_TELEGRAM_TOKEN (the bot people connect to from their manage page).
"""
import os
import sys
import time
from html import escape

import requests

from . import db, payments
from .search import find_jobs, job_key
from .send_daily import first_titles

PER_RUN = 3  # at most this many jobs per member each run, so Telegram stays useful rather than noisy


def send(token: str, chat_id: str, html: str) -> None:
    r = requests.post(f"https://api.telegram.org/bot{token}/sendMessage", timeout=20,
                      json={"chat_id": chat_id, "text": html, "parse_mode": "HTML", "disable_web_page_preview": True})
    r.raise_for_status()


def message(job: dict) -> str:
    company = f" at <b>{escape(job['company'])}</b>" if job["company"] else ""
    return (f"🔔 <a href=\"{escape(job['url'], quote=True)}\"><b>{escape(job['title'])}</b></a>{company}\n"
            f"<i>{escape(', '.join(job['matched']))}</i> (via {escape(job['source'])})")


def main() -> None:
    token = os.environ.get("JOB_ALERTS_TELEGRAM_TOKEN", "").strip()
    if not token:
        print("JOB_ALERTS_TELEGRAM_TOKEN not set -- Telegram alerts are off.")
        return
    db.init_db()
    paid_ids = db.paid_subscriber_ids()
    members = [s for s in db.confirmed_subscribers() if s.get("telegram_chat_id") and db.is_member(s, paid_ids)]
    print(f"{len(members)} member(s) with Telegram connected.")
    sent = failed = 0
    for sub in members:
        try:
            jobs = find_jobs(first_titles(sub["keywords"], payments.PAID_LIMITS[1]), sub["country"], sub["remote_only"],
                             sub["level"], db.already_sent(sub["id"]), n=PER_RUN, city=sub.get("city") or "")
            for job in jobs:
                send(token, sub["telegram_chat_id"], message(job))
                db.record_sent(sub["id"], [{**job, "key": job_key(job)}])  # one at a time: a failure mid-way doesn't lose track
                time.sleep(0.5)
            sent += len(jobs)
            print(f"- subscriber {sub['id']}: {len(jobs)} job(s) on Telegram")
        except Exception as e:  # one bad subscriber shouldn't stop the rest
            failed += 1
            print(f"- subscriber {sub['id']}: FAILED {e}")
    print(f"Done: {sent} job(s) sent, {failed} failed.")
    if failed and not sent:
        sys.exit(1)


if __name__ == "__main__":
    main()
