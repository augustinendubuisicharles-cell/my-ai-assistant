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
    if only := os.environ.get("ONLY_EMAIL", "").strip().lower():  # test run for one subscriber
        subs = [s for s in subs if s["email"].strip().lower() == only]
        print(f"Test run for one address: {len(subs)} matching confirmed subscriber(s).")
    require_payment = os.environ.get("REQUIRE_PAYMENT", "1") != "0"
    print(f"{len(subs)} confirmed subscriber(s); payment {'required' if require_payment else 'not required'}.")
    paid_ids = db.paid_subscriber_ids()
    sent = failed = 0
    for sub in subs:
        if require_payment:
            if not sub.get("paid_until"):  # confirmed before trials existed: start theirs now
                sub = db.start_trial(sub["id"], payments.TRIAL_DAYS)
            remind(sub, base_url)
            if not db.is_paid(sub):
                continue
        try:
            member = db.is_member(sub, paid_ids)
            n, titles = payments.limits(member)
            jobs = find_jobs(first_titles(sub["keywords"], titles), sub["country"], sub["remote_only"], sub["level"],
                             db.already_sent(sub["id"]), n=n, city=sub.get("city") or "")
            if not jobs:
                print(f"- subscriber {sub['id']}: no new matches, nothing sent")
                continue
            upgrade = "" if member or not payments.enabled() else (
                f"Members get up to {payments.PAID_LIMITS[0]} jobs a day across all {payments.PAID_LIMITS[1]} of your job titles, "
                "plus Telegram alerts as soon as jobs appear.")
            subject, text, html = emails.digest(jobs, datetime.now(timezone.utc), base_url, sub["token"], upgrade)
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


def first_titles(keywords_csv: str, count: int) -> str:
    return ", ".join([k.strip() for k in keywords_csv.split(",") if k.strip()][:count])


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
