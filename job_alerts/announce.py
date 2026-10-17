"""Sends the one-off "pick 5 job titles" email (emails.more_titles) to active members and trial users with fewer than 5.

    ONLY_EMAIL=you@example.com python -m job_alerts.announce   # one test email (they must have signed up)
    SEND_ALL=yes python -m job_alerts.announce                 # everyone with alerts running

Run by .github/workflows/job_alerts_announce.yml. Expired and unconfirmed sign-ups, and anyone with 5 titles already, are skipped.
"""
import os
import sys
import time

from . import db, emails, mailer


def titles(sub: dict) -> list[str]:
    return [w.strip() for w in (sub.get("keywords") or "").split(",") if w.strip()]


def main() -> None:
    base_url = os.environ.get("BASE_URL", "").rstrip("/")
    only = os.environ.get("ONLY_EMAIL", "").strip().lower()
    if not base_url:
        sys.exit("BASE_URL is required.")
    if not only and os.environ.get("SEND_ALL") != "yes":
        sys.exit("Set ONLY_EMAIL for a test, or SEND_ALL=yes to send to everyone.")
    db.init_db()
    paid_ids = db.paid_subscriber_ids()
    subs = [s for s in db.confirmed_subscribers() if db.is_paid(s) and (not only or s["email"].lower() == only)]
    if only and not subs:
        sys.exit(f"{only} isn't a confirmed subscriber with alerts running.")
    if not only:
        subs = [s for s in subs if len(titles(s)) < 5]
    members = sum(db.is_member(s, paid_ids) for s in subs)
    print(f"Sending to {len(subs)}: {members} member(s), {len(subs) - members} on trial.")
    sent = failed = 0
    for sub in subs:
        member = db.is_member(sub, paid_ids)
        try:
            subject, text, html = emails.more_titles(base_url, sub["token"], titles(sub))
            mailer.send(sub["email"], subject, text, html, unsubscribe_url=f"{base_url}/unsubscribe/{sub['token']}")
            sent += 1
            print(f"- subscriber {sub['id']}: sent ({'member' if member else 'trial'})")
            time.sleep(1)
        except Exception as e:
            failed += 1
            print(f"- subscriber {sub['id']}: FAILED {e}")
    print(f"Done: {sent} sent, {failed} failed.")
    if failed and not sent:
        sys.exit(1)


if __name__ == "__main__":
    main()
