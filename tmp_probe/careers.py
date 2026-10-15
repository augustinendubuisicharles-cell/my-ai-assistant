"""Temporary probe: which companies' career pages have remote non-tech jobs open worldwide."""
import re, requests, json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
S = ['automattic', 'remotecom', 'remote', 'deel', 'deelhq', 'zapier', 'buffer', 'doist', 'atlassian', 'shopify', 'github', 'elastic', 'duckduckgo', 'mozilla', 'cloudflare', 'hashicorp', 'netlify', 'webflow', 'miro', 'aha', 'ahasoftware', 'close', 'closeio', 'customerio', 'customer-io', 'toggl', 'mailerlite', 'helpscout', 'hotjar', 'canva', 'hubspot', 'semrush', 'superside', 'wikimedia', 'envato', 'coinbase', 'kraken', 'krakendigitalassetexchange', 'chainlinklabs', 'chainlink', 'brex', 'airwallex', 'oyster', 'oysterhr', 'andela', 'coursera', 'turing', 'invisible', 'invisibletechnologies', 'agency', 'invisibletech', 'crossover', 'supabase', 'sourcegraph', 'sourcegraph91', 'contra', 'lemonio', 'lemon', 'dynamitejobs', 'wellfound']
KW = re.compile(r"assistant|support|customer|admin|writer|content|social media|community|operations|success|recruit"
                r"|public relations|\bpr\b|communications|marketing|data entry|sales|annotat|transcri|translat|editor|moderat", re.I)
OPEN = re.compile(r"anywhere|worldwide|global|africa|emea|nigeria|international", re.I)
cut = datetime.now(timezone.utc) - timedelta(days=14)
def get(u, **p):
    r = requests.get(u, params=p, timeout=20, headers={"User-Agent": "Mozilla/5.0 JobAlert"})
    r.raise_for_status(); return r.json()
def dt(s):
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00")) if s else None
        return d.replace(tzinfo=timezone.utc) if d and not d.tzinfo else d
    except Exception: return None
def jobs(ats, s):
    if ats == "greenhouse":
        return [(j["title"], (j.get("location") or {}).get("name", ""), None, dt(j.get("first_published") or j.get("updated_at")))
                for j in get(f"https://boards-api.greenhouse.io/v1/boards/{s}/jobs")["jobs"]]
    if ats == "lever":
        d = get(f"https://api.lever.co/v0/postings/{s}", mode="json")
        return [(j["text"], (j.get("categories") or {}).get("location", ""), j.get("workplaceType") == "remote",
                 datetime.fromtimestamp(j["createdAt"] / 1000, timezone.utc)) for j in d]
    if ats == "ashby":
        return [(j["title"], j.get("location", ""), j.get("isRemote"), dt(j.get("publishedAt")))
                for j in get(f"https://api.ashbyhq.com/posting-api/job-board/{s}")["jobs"]]
    if ats == "workable":
        return [(j["title"], f'{j.get("city","")} {j.get("country","")}', j.get("telecommuting"), dt(j.get("published_on")))
                for j in get(f"https://apply.workable.com/api/v1/widget/accounts/{s}")["jobs"]]
    if ats == "recruitee":
        return [(j["title"], j.get("location", ""), j.get("remote"), dt(j.get("published_at")))
                for j in get(f"https://{s}.recruitee.com/api/offers/")["offers"]]
    if ats == "smartrecruiters":
        return [(j["name"], f'{(j.get("location") or {}).get("city","")} {(j.get("location") or {}).get("country","")}',
                 (j.get("location") or {}).get("remote"), dt(j.get("releasedDate")))
                for j in get(f"https://api.smartrecruiters.com/v1/companies/{s}/postings")["content"]]
def probe(a):
    ats, s = a
    try: js = jobs(ats, s)
    except Exception: return None
    try: return summary(ats, s, js)
    except Exception as e: return dict(ats=ats, slug=s, total=len(js), remote=0, nontech=0, open=0, recent=0, sample=[str(e)[:80]])
def summary(ats, s, js):
    if not js: return None
    rem = [j for j in js if j[2] or (j[2] is None and re.search(r"remote|anywhere", j[1] or "", re.I))]
    nt = [j for j in rem if KW.search(j[0])]
    return dict(ats=ats, slug=s, total=len(js), remote=len(rem), nontech=len(nt),
                open=sum(1 for j in rem if OPEN.search(j[1] or "")), recent=sum(1 for j in rem if j[3] and j[3] > cut),
                sample=[f"{t} | {l}" for t, l, *_ in nt[:4]])
res = [r for r in ThreadPoolExecutor(24).map(probe, [(a, s) for s in S for a in
       ["greenhouse", "lever", "ashby", "workable", "recruitee", "smartrecruiters"]]) if r]
res.sort(key=lambda r: r["slug"])
for r in res:
    print(f'{r["ats"]}:{r["slug"]} total={r["total"]} remote={r["remote"]} nontech={r["nontech"]} open={r["open"]} recent14d={r["recent"]}')
    for x in r["sample"]: print("    ", x)
