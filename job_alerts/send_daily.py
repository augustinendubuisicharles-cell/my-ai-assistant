"""Run once a day (by .github/workflows/job_alerts_daily.yml): finds new
matches for every confirmed subscriber and emails them.

Run from the repo root:  python -m job_alerts.send_daily
"""
import math
import os
import sys
import time
from datetime import datetime, timedelta, timezone

from . import db, emails, mailer, payments
from .search import clean_keywords, find_jobs, job_key


def main() -> None:
    base_url = os.environ.get("BASE_URL", "").rstrip("/")
    if not base_url:
        sys.exit("BASE_URL is required so emails can link to the site.")
    db.init_db()
    subs = db.confirmed_subscribers()
    only = os.environ.get("ONLY_EMAIL", "").strip().lower()
    if only:  # test run for one subscriber
        subs = [s for s in subs if s["email"].strip().lower() == only]
        print(f"Test run for one address: {len(subs)} matching confirmed subscriber(s).")
    require_payment = os.environ.get("REQUIRE_PAYMENT", "1") != "0"
    print(f"{len(subs)} confirmed subscriber(s); payment {'required' if require_payment else 'not required'}.")
    paid_ids = db.paid_subscriber_ids()
    first = os.environ.get("FIRST_SEARCH") == "1"  # run by the website right after someone confirms
    sent = failed = 0
    for sub in subs:
        if require_payment:
            if not sub.get("paid_until"):  # confirmed before trials existed: start theirs now
                sub = db.start_trial(sub["id"], payments.TRIAL_DAYS)
            remind(sub, base_url)
            if not db.is_paid(sub):
                db.note_run(sub["id"], "not active: trial or membership ended")
                continue
        try:
            member = db.is_member(sub, paid_ids)
            n, titles = payments.limits(member)
            sent_before = db.already_sent(sub["id"])
            if first and sent_before:
                print(f"- subscriber {sub['id']}: already has jobs, skipping the first-search email")
                continue
            if not first and not only and emailed_this_morning(sub):
                print(f"- subscriber {sub['id']}: already emailed this morning, skipping")
                continue
            if os.environ.get("ONLY_EMAIL"):
                print(f"- subscriber {sub['id']}: searching {first_titles(sub['keywords'], titles)!r}, country "
                      f"{sub['country'] or 'any'}, {'remote' if sub['remote_only'] else 'on-site near ' + (sub.get('city') or '?')}, "
                      f"level {sub['level']}, {len(sent_before)} job(s) already sent")
            jobs = find_jobs(first_titles(sub["keywords"], titles), sub["country"], sub["remote_only"], sub["level"],
                             sent_before, n=n, city=sub.get("city") or "")
            if not jobs:
                # A new subscriber, or one who has never had a single match: tell them once, with a nudge
                # towards broader titles, so nobody is left waiting in silence.
                tip = first or (not sent_before and not sub.get("titles_tip_at"))
                if tip:
                    subject, text, html = emails.no_matches_yet(base_url, sub["token"], first_titles(sub["keywords"], titles))
                    mailer.send(sub["email"], subject, text, html, unsubscribe_url=f"{base_url}/unsubscribe/{sub['token']}")
                    db.mark(sub["id"], "titles_tip_at")
                db.note_run(sub["id"], "no new matches" + (" (sent the try-broader-titles email)" if tip else ""))
                print(f"- subscriber {sub['id']}: no new matches{', sent the try-broader-titles email' if tip else ', nothing sent'}")
                continue
            subject, text, html = emails.digest(jobs, datetime.now(timezone.utc), base_url, sub["token"],
                                                None if member else trial_info(sub), first=first,
                                                letters=member and os.environ.get("COVER_LETTERS") == "1")
            mailer.send(sub["email"], subject, text, html, unsubscribe_url=f"{base_url}/unsubscribe/{sub['token']}")
            db.record_sent(sub["id"], [job_key(j) for j in jobs])
            sent += 1
            db.note_run(sub["id"], f"sent {len(jobs)} job{'s' if len(jobs) != 1 else ''}")
            print(f"- subscriber {sub['id']}: sent {len(jobs)} job(s)")
            time.sleep(1)
        except Exception as e:  # one bad subscriber shouldn't stop everyone else's email
            failed += 1
            print(f"- subscriber {sub['id']}: FAILED {e}")
            try:
                db.note_run(sub["id"], f"FAILED: {e}")
            except Exception:
                pass
    if not only and not first:
        remind_unconfirmed(base_url)
    print(f"Done: {sent} email(s) sent, {failed} failed.")
    if failed and not sent:
        sys.exit(1)


def emailed_this_morning(sub: dict) -> bool:
    """True if this subscriber already got an email since 05:00 UTC today, so a second
    morning run (the website's 06:00 start plus GitHub's late-running fallback) sends nothing more."""
    last = db._aware(sub.get("last_sent_at"))
    start = db.now().replace(hour=5, minute=0, second=0, microsecond=0)
    return bool(last) and db.now() >= start and last >= start


def trial_info(sub: dict) -> dict:
    """What the free-trial countdown box in each email needs."""
    left = (db._aware(sub["paid_until"]) - db.now()).total_seconds() / 86400 if sub.get("paid_until") else 0
    jobs, titles = payments.PAID_LIMITS
    return {"days_left": max(1, math.ceil(left)), "price": f"₦{payments.PRICE_NGN:,}",
            "perks": f"{jobs} jobs a day, all {titles} job titles, AI cover letters and Telegram alerts, "
                     f"for {payments.PERIOD_DAYS // 30} months", "can_pay": payments.enabled()}


def first_titles(keywords_csv: str, count: int) -> str:
    """The titles their plan searches, after fixing typos and vague words (search.clean_keywords)."""
    return ", ".join(clean_keywords(keywords_csv)[:count])


def remind_unconfirmed(base_url: str) -> None:
    """One reminder, a day after sign-up, to people who never confirmed their email."""
    for sub in db.unconfirmed_to_remind():
        try:
            subject, text, html = emails.confirm_reminder(base_url, sub["token"])
            mailer.send(sub["email"], subject, text, html, unsubscribe_url=f"{base_url}/unsubscribe/{sub['token']}")
            db.mark(sub["id"], "confirm_reminded_at")
            print(f"- subscriber {sub['id']}: confirm-your-email reminder sent")
        except Exception as e:
            print(f"- subscriber {sub['id']}: confirm reminder FAILED {e}")


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
