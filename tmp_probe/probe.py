"""Rehearsal of the morning run: same choices as send_daily, but no emails and no database writes."""
from collections import Counter
from datetime import datetime, timezone
from job_alerts import db, emails, payments
from job_alerts.send_daily import first_titles, trial_info
from job_alerts.search import find_jobs

subs = db.confirmed_subscribers()
paid = db.paid_subscriber_ids()
summary, problems = Counter(), []
for sub in subs:
    if not sub.get("paid_until") or not db.is_paid(sub):
        summary["not active (trial or membership ended)"] += 1
        continue
    member = db.is_member(sub, paid)
    n, titles = payments.limits(member)
    minimum = payments.DAILY_MINIMUM[member]
    spares = [] if member else None
    try:
        jobs = find_jobs(first_titles(sub["keywords"], titles), sub["country"], sub["remote_only"], sub["level"],
                         db.already_sent(sub["id"]), n=n, city=sub.get("city") or "", minimum=minimum,
                         hours=sub.get("hours") or "any", cv=None, spares=spares)
        for i, j in enumerate(jobs):
            j["id"] = 10**9 + i
        emails.digest(jobs, datetime.now(timezone.utc), "https://jobalert.me.uk", sub["token"],
                      None if member else trial_info(sub), letters=member, tracker=member)
    except Exception as e:
        problems.append(f"subscriber {sub['id']}: ERROR {e}")
        continue
    kind = "member" if member else "trial"
    summary[f"{kind} total"] += 1
    if len(jobs) < minimum:
        problems.append(f"subscriber {sub['id']} ({kind}): only {len(jobs)} job(s), titles {first_titles(sub['keywords'], titles)!r}, {sub['country']}, remote={sub['remote_only']}, level {sub['level']}")
    else:
        summary[f"{kind} with at least {minimum}"] += 1
    if member and len(spares) < 5:
        summary["members with fewer than 5 spares"] += 1
    print(f"RESULT subscriber {sub['id']} {kind}: {len(jobs)} jobs, spares {len(spares) if spares is not None else '-'}")
print("SUMMARY", dict(summary))
for p in problems:
    print("PROBLEM", p)
