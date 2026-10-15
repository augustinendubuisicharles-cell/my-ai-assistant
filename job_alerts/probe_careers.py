"""Temporary: which career-page feeds work, how many remote jobs each has, and how many fit Nigeria."""
from collections import Counter
from job_alerts import search as s
for ats, slugs in s.CAREER_PAGES.items():
    for slug in slugs:
        try:
            jobs = s._career_page(ats, slug)
            rem = [j for j in jobs if (j["remote"] if j["remote"] is not None else any(w in (j["location"] or "").lower() for w in s.REMOTE_WORDS))]
            dated = sum(1 for j in rem if j["posted"])
            ng = sum(1 for j in rem if s.location_fits(j["location"] or "Remote", "Nigeria", True))
            print(f"{ats}:{slug} total={len(jobs)} remote={len(rem)} dated={dated} fits_NG={ng} e.g. {rem[0]['location'] if rem else ''!r}")
        except Exception as e:
            print(f"{ats}:{slug} FAIL {str(e)[:70]}")
r, boards = s._search(["virtual assistant", "customer support", "content writer", "data entry", "software engineer"], "Nigeria", True, "any", "", set(), Counter())
print("boards:", dict(boards))
print("picked from careers:", [(j["title"], j["company"]) for j in r if j["source"] == "Company careers page"][:15])
