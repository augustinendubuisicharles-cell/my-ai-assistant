"""Temporary: run every confirmed user's real search (no emails, nothing saved) and count jobs per source."""
import time; T0 = time.time()
from collections import Counter
from job_alerts import db, payments
from job_alerts.search import find_jobs
from job_alerts.send_daily import first_titles
db.init_db()
paid = db.paid_subscriber_ids()
src, empty = Counter(), 0
for sub in db.confirmed_subscribers():
    member = db.is_member(sub, paid)
    n, titles = payments.limits(member)
    jobs = find_jobs(first_titles(sub["keywords"], titles), sub["country"], sub["remote_only"], sub["level"],
                     db.already_sent(sub["id"]), n=n, city=sub.get("city") or "",
                     minimum=payments.DAILY_MINIMUM[member], hours=sub.get("hours") or "any")
    src.update(j["source"] for j in jobs)
    empty += not jobs
    print(f"RESULT sub {sub['id']}: {len(jobs)} jobs | {first_titles(sub['keywords'], titles)} | {sub['country']} | "
          + ", ".join(f"{j['source']}" for j in jobs))
print("SUMMARY", empty, "users with 0 jobs;", dict(src))
print("SECONDS", round(time.time() - T0))
