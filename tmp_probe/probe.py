import json, re, time, requests
from concurrent.futures import ThreadPoolExecutor
from job_alerts.discover_boards import PATTERNS, NOT_SLUGS
H = {"User-Agent": "JobAlert board discovery (jobalert.me.uk)"}
idx = requests.get("https://index.commoncrawl.org/collinfo.json", headers=H, timeout=60).json()
print("latest indexes:", [i["id"] for i in idx[:4]])
api = idx[0]["cdx-api"]
QUERIES = {"greenhouse": ["boards.greenhouse.io/*", "job-boards.greenhouse.io/*", "job-boards.eu.greenhouse.io/*"],
           "lever": ["jobs.lever.co/*"], "ashby": ["jobs.ashbyhq.com/*"], "workable": ["apply.workable.com/*"],
           "recruitee": ["*.recruitee.com"]}
def get(params, tries=4):
    for t in range(tries):
        try:
            r = requests.get(api, params=params, headers=H, timeout=120)
            if r.status_code == 200: return r.text
            print("  status", r.status_code)
        except Exception as e:
            print("  err", str(e)[:80])
        time.sleep(5 * (t + 1))
    return ""
found = {}
t0 = time.time()
for ats, qs in QUERIES.items():
    slugs = set()
    for q in qs:
        n = get({"url": q, "showNumPages": "true", "output": "json"})
        try: pages = json.loads(n)["pages"]
        except Exception: print("  pages?", n[:100]); pages = 0
        print(f"{ats} {q}: {pages} pages")
        for p in range(min(pages, 40)):
            text = get({"url": q, "output": "json", "fl": "url", "page": p})
            for line in text.splitlines():
                try: u = json.loads(line)["url"].lower()
                except Exception: continue
                for s in re.findall(PATTERNS[ats], u):
                    s = s.strip(".-_").split("?")[0]
                    if s and s not in NOT_SLUGS: slugs.add(s)
    found[ats] = slugs
    print(f"  -> {ats}: {len(slugs)} unique companies ({int(time.time()-t0)}s so far)")
print("TOTAL", sum(len(v) for v in found.values()))
with open("cc_slugs.json", "w") as f: json.dump({k: sorted(v) for k, v in found.items()}, f)
