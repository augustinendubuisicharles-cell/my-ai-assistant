"""Temporary: for each job board, look at a few live adverts and report where 'Apply' leads and
whether the page asks people to sign up / log in first."""
import re, json
from urllib.parse import urlparse
import requests
from job_alerts import search as s

ATS = ("greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "smartrecruiters.com", "bamboohr.com",
       "recruitee.com", "teamtailor.com", "breezy.hr", "jobvite.com", "myworkdayjobs.com", "personio", "pinpointhq",
       "rippling", "dover.com", "wellfound.com")
GATE = re.compile(r"(sign ?up|log ?in|register|create (an |your )?account)[^<]{0,40}(to|before) (apply|view|see)|"
                  r"(apply|applying)[^<]{0,30}(requires?|need)[^<]{0,20}(account|sign ?up|log ?in)|members only|premium members", re.I)
HREF = re.compile(r'href="(https?://[^"]+)"', re.I)

def look(url):
    try:
        r = requests.get(url, headers=s.HEADERS, timeout=15, allow_redirects=True)
    except Exception as e:
        return {"err": str(e)[:80]}
    html = r.text
    ats = sorted({urlparse(h).netloc for h in HREF.findall(html) if any(a in h for a in ATS)})
    g = GATE.search(html)
    return {"code": r.status_code, "final": urlparse(r.url).netloc, "ats_links": ats[:3],
            "gate": g.group(0)[:70] if g else ""}

boards = {
    "Himalayas": s.from_himalayas("developer", ""), "Jobicy": s.from_jobicy("dev"),
    "Remotive": s.from_remotive(), "We Work Remotely": s.from_weworkremotely(), "RemoteOK": s.from_remoteok(),
    "Working Nomads": s.from_workingnomads(), "Arbeitnow": s.from_arbeitnow(), "The Muse": s.from_themuse(),
    "Jobspresso": s.from_jobspresso(),
}
for name, jobs in boards.items():
    print(f"\n=== {name}: {len(jobs)} jobs")
    for j in list(jobs)[:4]:
        print(" ", urlparse(j["url"]).netloc, json.dumps(look(j["url"])))
