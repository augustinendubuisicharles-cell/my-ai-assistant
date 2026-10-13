"""Run once a day (by .github/workflows/job_alerts_daily.yml): finds new
matches for every confirmed subscriber and emails them.

Run from the repo root:  python -m job_alerts.send_daily
"""
import os
import sys
import time
from datetime import datetime, timezone

from . import db, emails, mailer
from .search import find_jobs, job_key


def main() -> None:
    base_url = os.environ.get("BASE_URL", "").rstrip("/")
    if not base_url:
        sys.exit("BASE_URL is required so emails can link to the site.")
    db.init_db()
    subs = db.confirmed_subscribers()
    print(f"{len(subs)} confirmed subscriber(s).")
    sent = failed = 0
    for sub in subs:
        try:
            jobs = find_jobs(sub["keywords"], sub["country"], sub["remote_only"], sub["level"], db.already_sent(sub["id"]))
            if not jobs:
                print(f"- subscriber {sub['id']}: no new matches, nothing sent")
                continue
            subject, text, html = emails.digest(jobs, datetime.now(timezone.utc), base_url, sub["token"])
            mailer.send(sub["email"], subject, text, html, unsubscribe_url=f"{base_url}/unsubscribe/{sub['token']}")
            db.record_sent(sub["id"], [job_key(j) for j in jobs])
            sent += 1
            print(f"- subscriber {sub['id']}: sent {len(jobs)} job(s)")
            time.sleep(1)
        except Exception as e:  # one bad subscriber shouldn't stop everyone else's email
            failed += 1
            print(f"- subscriber {sub['id']}: FAILED {e}")
    print(f"Done: {sent} email(s) sent, {failed} failed.")
    if failed and not sent:
        sys.exit(1)


if __name__ == "__main__":
    main()
