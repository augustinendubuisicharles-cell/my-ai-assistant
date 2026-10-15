"""One-off: fills in the advert (description, location, pay) for jobs sent before the job page stored them,
so their page on the site shows the whole advert. Searches the boards again and matches each sent job by its
link or by title + company. Only fills empty fields; safe to run more than once."""
from sqlalchemy import select, update

from job_alerts import db, search as s


def main() -> None:
    db.init_db()
    with db.engine.begin() as conn:
        rows = [dict(r) for r in conn.execute(select(db.sent_jobs).where(
            db.sent_jobs.c.description.is_(None), db.sent_jobs.c.sent_at >= db.now() - db.FRESH)).mappings()]
    print(f"{len(rows)} recent sent job(s) have no advert saved")
    if not rows:
        return
    subs = {r["id"]: r for r in db.confirmed_subscribers()}
    pool = list(s.remote_feeds())
    for sid in {r["subscriber_id"] for r in rows}:
        sub = subs.get(sid)
        if not sub:
            continue
        keywords = s.clean_keywords(sub.get("keywords") or "")[:5]
        country, city, remote = sub.get("country") or "", sub.get("city") or "", bool(sub.get("remote_only", True))
        for k in keywords + s.neighbours(keywords):
            pool += s.from_himalayas(k, country) + s.from_jobicy(k) + s.from_jooble(k, "" if remote else (city or country))
            if not remote:
                pool += s.from_adzuna(k, country, city) + (s.from_reed(k, city) if country == "United Kingdom" else ())
    index = {}
    for job in pool:
        for key in s.job_keys(job):
            index.setdefault(key, job)
    found = 0
    with db.engine.begin() as conn:
        for r in rows:
            title_key, _, link = r["job_key"].partition("\t")
            job = index.get(link) or index.get(r["url"] or "") or index.get(title_key)
            if not job or not job["desc"]:
                continue
            conn.execute(update(db.sent_jobs).where(db.sent_jobs.c.id == r["id"]).values(
                description=job["desc"][:db.DESCRIPTION_MAX], location=r["location"] or (job["location"] or "")[:200],
                pay=r["pay"] or (job["pay"] or "")[:120]))
            found += 1
    print(f"Filled in {found} of {len(rows)}; the rest are no longer listed on the boards and keep the link to the original advert")


if __name__ == "__main__":
    main()
