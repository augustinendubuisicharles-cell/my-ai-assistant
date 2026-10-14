"""Run once a day (by .github/workflows/job_alerts_daily.yml): finds new
matches for every confirmed subscriber and emails them.

Run from the repo root:  python -m job_alerts.send_daily
"""
import os
import sys
import time
from datetime import datetime, timedelta, timezone

from . import db, emails, mailer, payments
from .search import find_jobs, job_key


def main() -> None:
    base_url = os.environ.get("BASE_URL", "").rstrip("/")
    if not base_url:
        sys.exit("BASE_URL is required so emails can link to the site.")
    db.init_db()
    subs = db.confirmed_subscribers()
    require_payment = os.environ.get("REQUIRE_PAYMENT", "1") != "0"
    print(f"{len(subs)} confirmed subscriber(s); payment {'required' if require_payment else 'not required'}.")
    sent = failed = 0
    for sub in subs:
        if require_payment:
            if not sub.get("paid_until"):  # confirmed before trials existed: start theirs now
                sub = db.start_trial(sub["id"], payments.TRIAL_DAYS)
            remind(sub, base_url)
            if not db.is_paid(sub):
                continue
        try:
            jobs = find_jobs(sub["keywords"], sub["country"], sub["remote_only"], sub["level"], db.already_sent(sub["id"]),
                             city=sub.get("city") or "")
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


def remind(sub: dict, base_url: str) -> None:
    """Emails once when 2 or fewer days of trial or paid time are left: a renew link, or
    (before payments are switched on) a note that the free alerts are ending."""
    until = db._aware(sub.get("paid_until"))
    if not until or not (-timedelta(days=1) < until - db.now() <= timedelta(days=2)) or db._aware(sub.get("reminded_for")) == until:
        return
    try:
        subject, text, html = emails.renewal_reminder(base_url, sub["token"], until, f"NGN {payments.PRICE_NGN:,}",
                                                      can_pay=payments.enabled())
        mailer.send(sub["email"], subject, text, html, unsubscribe_url=f"{base_url}/unsubscribe/{sub['token']}")
        db.mark_reminded(sub["id"], until)
        print(f"- subscriber {sub['id']}: renewal reminder sent")
    except Exception as e:
        print(f"- subscriber {sub['id']}: reminder FAILED {e}")


if __name__ == "__main__":
    main()
