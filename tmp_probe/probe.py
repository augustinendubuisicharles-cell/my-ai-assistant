# Temporary: correct subscriber 136's morning result, which a duplicate run overwrote with FAILED.
from datetime import timedelta
from sqlalchemy import select, update, func
from job_alerts import db

with db.engine.begin() as c:
    n = c.execute(select(func.count()).select_from(db.sent_jobs).where(
        db.sent_jobs.c.subscriber_id == 136, db.sent_jobs.c.sent_at > db.now() - timedelta(hours=6))).scalar()
    r = c.execute(select(db.subscribers.c.last_run_result).where(db.subscribers.c.id == 136)).scalar()
    print("jobs saved today:", n, "| current result starts:", (r or "")[:60])
    if n and (r or "").startswith("FAILED: (psycopg.errors.UniqueViolation)"):
        c.execute(update(db.subscribers).where(db.subscribers.c.id == 136).values(last_run_result=f"sent {n} job{'s' if n != 1 else ''}"))
        print("corrected to:", f"sent {n} jobs")
