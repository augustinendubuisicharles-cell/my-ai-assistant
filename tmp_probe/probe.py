"""Read-only: build (not send) a digest with subscriber 42's row 164 as the Did-you-apply item."""
import traceback
from datetime import datetime, timezone
from sqlalchemy import select
from job_alerts import db, emails

with db.engine.connect() as c:
    row = dict(c.execute(select(db.sent_jobs).where(db.sent_jobs.c.id == 164)).mappings().first())
    jobs = [dict(r) for r in c.execute(select(db.sent_jobs).where(db.sent_jobs.c.subscriber_id == 42).order_by(db.sent_jobs.c.id)).mappings()]
print({k: (v if k != "description" else (v or "")[:40]) for k, v in row.items()})
for label, kw in (("ask", dict(ask=[row])), ("waiting", dict(waiting=[row])), ("both", dict(ask=[row], waiting=[row]))):
    try:
        emails.digest([{**jobs[-1], "matched": ["x"]}], datetime.now(timezone.utc), "https://b", "tok", None,
                      letters=True, tracker=True, **kw)
        print(label, "ok")
    except Exception:
        print(label, "FAILED"); traceback.print_exc()
