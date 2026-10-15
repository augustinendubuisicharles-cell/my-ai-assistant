"""Temporary: find company job boards (Greenhouse, Lever, Ashby, Workable, Recruitee) and keep the ones that work.
Sources: Hacker News "Who is hiring" threads (links to boards) and tmp_probe/names.txt guesses."""
import json, re, requests
from html import unescape
from concurrent.futures import ThreadPoolExecutor
H = {"User-Agent": "Mozilla/5.0 JobAlert"}
PAT = {"greenhouse": r"(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io/(?:embed/job_board\?for=)?([a-z0-9_-]+)",
       "lever": r"jobs\.lever\.co/([a-z0-9._-]+)", "ashby": r"jobs\.ashbyhq\.com/([a-z0-9._%-]+)",
       "workable": r"apply\.workable\.com/([a-z0-9_-]+)", "recruitee": r"([a-z0-9-]+)\.recruitee\.com"}
found = set()
try:
    for ats, slugs in json.load(open("job_alerts/career_pages.json")).items():
        found |= {(ats, s) for s in slugs}
except FileNotFoundError:
    pass
stories = []
for page in range(6):
    r = requests.get("https://hn.algolia.com/api/v1/search_by_date", params={"tags": "story,author_whoishiring",
                     "hitsPerPage": 50, "page": page}, headers=H, timeout=30).json()
    stories += [h["objectID"] for h in r["hits"] if "who is hiring" in h["title"].lower()]
print("HN threads:", len(stories))
def thread(i):
    try: return requests.get(f"https://hn.algolia.com/api/v1/items/{i}", headers=H, timeout=60).text
    except Exception: return ""
for text in ThreadPoolExecutor(8).map(thread, stories[:72]):
    text = unescape(unescape(text.replace("\\/", "/"))).lower()
    for ats, p in PAT.items():
        for s in re.findall(p, text):
            s = s.strip(".-_").split("?")[0]
            if s and s not in {"embed", "api", "v1", "jobs", "www", "careers", "app", "boards"}:
                found.add((ats, s))
def search(args):
    q, page = args
    try:
        r = requests.get("https://hn.algolia.com/api/v1/search", params={"query": q, "tags": "comment",
                         "hitsPerPage": 1000, "page": page}, headers=H, timeout=60).json()
        return " ".join(h.get("comment_text") or "" for h in r.get("hits", []))
    except Exception:
        return ""
qs = [(q, p) for q in ["greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "recruitee.com"] for p in range(10)]
for text in ThreadPoolExecutor(8).map(search, qs):
    text = unescape(unescape(text)).lower()
    for ats, p in PAT.items():
        for s in re.findall(p, text):
            s = s.strip(".-_").split("?")[0]
            if s and s not in {"embed", "api", "v1", "jobs", "www", "careers", "app", "boards"}:
                found.add((ats, s))
print("from HN:", len(found))
names = set(open("tmp_probe/names.txt").read().split())
for n in names:
    for v in {n, n.replace(".", ""), n + "hq", n + "inc"}:
        for ats in ("greenhouse", "lever", "ashby", "workable"):
            found.add((ats, v))
print("candidates:", len(found))
def get(u, **p):
    r = requests.get(u, params=p, headers=H, timeout=25); r.raise_for_status(); return r.json()
def check(c):
    ats, s = c
    try:
        if ats == "greenhouse":
            d = get(f"https://boards-api.greenhouse.io/v1/boards/{s}/jobs")["jobs"]
            rem = [j for j in d if re.search(r"remote|anywhere", (j.get("location") or {}).get("name", ""), re.I)]
        elif ats == "lever":
            d = get(f"https://api.lever.co/v0/postings/{s}", mode="json")
            rem = [j for j in d if j.get("workplaceType") == "remote" or re.search(r"remote", (j.get("categories") or {}).get("location", "") or "", re.I)]
        elif ats == "ashby":
            d = get(f"https://api.ashbyhq.com/posting-api/job-board/{s}")["jobs"]
            rem = [j for j in d if j.get("isRemote")]
        elif ats == "workable":
            d = get(f"https://apply.workable.com/api/v1/widget/accounts/{s}")["jobs"]
            rem = [j for j in d if j.get("telecommuting")]
        else:
            d = get(f"https://{s}.recruitee.com/api/offers/")["offers"]
            rem = [j for j in d if j.get("remote")]
        return (ats, s, len(d), len(rem)) if d else None
    except Exception:
        return None
ok = [r for r in ThreadPoolExecutor(48).map(check, sorted(found)) if r]
best = {}
for ats, s, total, rem in ok:  # one board per company name
    key = re.sub(r"(hq|inc)$", "", s.replace("-", "").replace(".", ""))
    if key not in best or rem > best[key][3]:
        best[key] = (ats, s, total, rem)
boards = sorted(best.values())
print("working boards:", len(boards), "with remote jobs now:", sum(1 for b in boards if b[3]),
      "total jobs:", sum(b[2] for b in boards), "remote jobs:", sum(b[3] for b in boards))
out = {}
for ats, s, total, rem in boards:
    out.setdefault(ats, []).append(s)
json.dump(out, open("job_alerts/career_pages.json", "w"), indent=0, sort_keys=True)
