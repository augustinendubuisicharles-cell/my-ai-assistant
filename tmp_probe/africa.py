"""Temporary probe: Workable's public job search + Breezy/SmartRecruiters/Teamtailor boards for VA and support roles."""
import json, re, requests
from concurrent.futures import ThreadPoolExecutor
H = {"User-Agent": "Mozilla/5.0 JobAlert", "Accept": "application/json"}
KW = re.compile(r"assistant|support|customer|admin|operations|success|service|care|virtual|receptionist|data entry|helpdesk|help desk|call", re.I)
# 1. Workable's job search (jobs.workable.com)
for q, loc in [("virtual assistant", "Nigeria"), ("customer support", "Nigeria"), ("customer service", ""), ("virtual assistant", ""),
               ("customer support", "Africa"), ("executive assistant", "")]:
    for url in ["https://jobs.workable.com/api/v1/jobs", "https://jobs.workable.com/api/v2/jobs"]:
        try:
            r = requests.get(url, params={"query": q, "location": loc, "workplace": "remote", "remote": "true"}, headers=H, timeout=30)
            print("WORKABLE", url[-7:], q, loc, r.status_code, r.headers.get("content-type"), r.text[:300].replace("\n", " "))
        except Exception as e:
            print("WORKABLE err", e)
S = """paystack flutterwave moniepoint kuda opay palmpay piggyvest cowrywise carbon fairmoney renmoney branch interswitch paga
teamapt sterling access gtbank zenith wema providus fcmb ecobank stanbic fidelity union polaris jumia konga glovo bolt uber
chowdeck heyfood gokada moove max lagosride treepz andela decagon semicolon alx alxafrica gebeya kuda mono okra lendsqr
sendbox gig shipbubble kwik terminal africa yellowcard busha quidax luno roqqu patricia bitnob chipper chippercash
helium health54 mdaas reliancehealth wellahealth ubuntu mpharma lifebank 54gene thrive bamboo risevest trove chaka
seamlesshr workpay talentql outsource global outsourceglobal hirequest techies vacancymail jobberman myjobmag
supportninja partnerhero peaksupport influx simplr helpware boldly belay prialto athena wing wingassistant magic
virtualstaff timeetc delegated assistantsquad virtalent cyberbacker hirewithnear near stealthagents stealth outsourcedoers
virtualassistantsnigeria remotebliss bruntwork bruntworkph ossisto tasks taskus ttec teleperformance concentrix
transcom sitel foundever alorica startek sykes majorel webhelp telus telusinternational cognizant genpact wns
sutherland conduent iq tcs infosys wipro hcl capgemini accenture ibex ibexglobal etech arise liveops working solutions
workingsolutions supportyourapp hugo hugoinc go1 trilogy crossover remote deel oyster papayaglobal multiplier
cloudfactory sama samasource appen lionbridge rws telus transperfect welocalize toloka outlier remotasks
fiverr upwork toptal shopify automattic doist zapier hotjar buffer
""".split()
def get(u, **p):
    r = requests.get(u, params=p, headers=H, timeout=25); r.raise_for_status(); return r
def board(a):
    ats, s = a
    try:
        if ats == "breezy":
            d = get(f"https://{s}.breezy.hr/json").json()
            jobs = [(j.get("name"), (j.get("location") or {}).get("name", ""), (j.get("location") or {}).get("is_remote")) for j in d]
        elif ats == "smartrecruiters":
            d = get(f"https://api.smartrecruiters.com/v1/companies/{s}/postings", limit=100).json()["content"]
            jobs = [(j.get("name"), f'{(j.get("location") or {}).get("city","")} {(j.get("location") or {}).get("country","")}',
                     (j.get("location") or {}).get("remote")) for j in d]
        elif ats == "teamtailor":
            t = get(f"https://{s}.teamtailor.com/jobs.rss").text
            jobs = [(m, "", None) for m in re.findall(r"<item>.*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>", t, re.S)]
        else:
            d = get(f"https://apply.workable.com/api/v1/widget/accounts/{s}").json()["jobs"]
            jobs = [(j.get("title"), f'{j.get("city","")} {j.get("country","")}', j.get("telecommuting")) for j in d]
        if not jobs: return None
        hits = [j for j in jobs if KW.search(j[0] or "")]
        return (ats, s, len(jobs), sum(1 for j in jobs if j[2]), len(hits), [f"{t} | {l}" for t, l, _ in hits[:3]])
    except Exception:
        return None
res = [r for r in ThreadPoolExecutor(32).map(board, [(a, s) for s in S for a in ("breezy", "smartrecruiters", "teamtailor", "workable")]) if r]
for r in sorted(res, key=lambda r: -r[4]):
    print(f"BOARD {r[0]}:{r[1]} total={r[2]} remote={r[3]} va_support={r[4]}")
    for x in r[5]: print("     ", x)
