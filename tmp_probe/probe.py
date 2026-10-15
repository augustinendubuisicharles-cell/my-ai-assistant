"""Dry run (no emails, no writes): what the morning search would pick for a few real subscribers now."""
from job_alerts import db, payments
from job_alerts.send_daily import first_titles
from job_alerts.search import find_jobs
db_subs = {s["id"]: s for s in db.confirmed_subscribers()}
paid = db.paid_subscriber_ids()
for sid in (15, 92, 90):
    sub = db_subs.get(sid)
    if not sub:
        continue
    member = db.is_member(sub, paid)
    n, titles = payments.limits(member)
    print(f"--- subscriber {sid}: member={member} titles={first_titles(sub['keywords'], titles)!r} {sub['country']} level {sub['level']}")
    spares = [] if member else None
    jobs = find_jobs(first_titles(sub["keywords"], titles), sub["country"], sub["remote_only"], sub["level"], db.already_sent(sid),
                     n=n, city=sub.get("city") or "", minimum=payments.DAILY_MINIMUM[member], hours=sub.get("hours") or "any",
                     spares=spares)
    for j in jobs:
        print(f"   {j['title']} | {j['company']} | {j['source']} | {' · '.join(j['matched'][:3])}")
