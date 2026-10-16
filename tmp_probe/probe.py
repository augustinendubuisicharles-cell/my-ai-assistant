"""Read-only: subscriber 42's tracker rows."""
from sqlalchemy import text
from job_alerts import db, send_daily

with db.engine.connect() as c:
    for r in c.execute(text("select id, title, status, status_at, clicked_at, asked_count, sent_at, posted_at, matched is null as m_null, "
                            "left(matched, 60) as m, url from sent_jobs where subscriber_id=42 and (status is not null or clicked_at is not null) order by id")).mappings():
        print(dict(r), "open:", send_daily.still_open(r["url"]))
    print("waiting:", [(w["id"], type(w["matched"]).__name__) for w in db.jobs_waiting(42)])
    print("ask:", [(w["id"], type(w["matched"]).__name__) for w in db.jobs_to_ask(42)])
    print("all members' not_yet rows with NULL matched:", c.execute(text("select count(*) from sent_jobs where status='not_yet' and matched is null")).scalar())
    print("not_yet rows total:", c.execute(text("select count(*) from sent_jobs where status='not_yet'")).scalar())
