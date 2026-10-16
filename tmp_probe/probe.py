"""Read-only replay of this morning's run for subscriber 42, with the full traceback. No emails, no writes."""
import os, traceback
from sqlalchemy import text
from job_alerts import db, mailer, send_daily

with db.engine.connect() as c:
    r = c.execute(text("select last_sent_at, last_run_at, last_run_result, paid_until, hours, level, remote_only, country "
                       "from subscribers where id=42")).mappings().first()
    print("sub 42:", dict(r))
    print("sent today:", c.execute(text("select count(*) from sent_jobs where subscriber_id=42 and sent_at > now() - interval '3 hours'")).scalar())
    print("spares:", c.execute(text("select count(*) from spare_jobs where subscriber_id=42")).scalar())

def boom(*a, **k):
    raise AssertionError("write blocked in probe")
db.record_sent = lambda sid, jobs, board=False: list(range(1, len(jobs) + 1))
for name in ("unsend", "save_spares", "mark_asked", "note_run", "mark", "start_trial", "mark_reminded"):
    setattr(db, name, lambda *a, **k: None)
db.trim_descriptions = lambda *a, **k: None
db.init_db = lambda *a, **k: None
mailer.send = lambda *a, **k: print("  (email built, not sent)")
send_daily.remind = lambda *a, **k: None
send_daily.remind_unconfirmed = lambda *a, **k: None
send_daily.emailed_this_morning = lambda sub: False
subs = [s for s in db.confirmed_subscribers() if s["id"] == 42]
db.confirmed_subscribers = lambda: subs
orig_digest = send_daily.emails.digest
def digest(*a, **k):
    try:
        return orig_digest(*a, **k)
    except Exception:
        traceback.print_exc()
        raise
send_daily.emails.digest = digest
orig_find = send_daily.find_jobs
def find(*a, **k):
    try:
        return orig_find(*a, **k)
    except Exception:
        traceback.print_exc()
        raise
send_daily.find_jobs = find
os.environ["BASE_URL"] = "https://jobalert.me.uk"
send_daily.main()
