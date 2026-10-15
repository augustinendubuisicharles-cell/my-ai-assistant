from collections import Counter
from job_alerts import db, search as s
subs = {x["id"]: x for x in db.confirmed_subscribers()}
for sid in (98, 86):
    sub = subs[sid]
    print("---", sid, sub["keywords"], sub["country"], sub["remote_only"], sub["level"], sub.get("hours"), sub.get("city"))
    why = Counter()
    seen = s.sent_keys(db.already_sent(sid))
    pool, _ = s._search([], sub["country"], sub["remote_only"], sub["level"], sub.get("city") or "", seen, why, sub.get("hours") or "any", any_title=True)
    print("any-title pool", len(pool), dict(why.most_common(8)))
    for j in pool[:5]:
        print("  ", j["title"], "|", j["source"], "|", j["location"])
