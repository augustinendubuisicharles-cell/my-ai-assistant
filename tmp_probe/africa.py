"""Temporary probe: Nigerian employers' boards with jobs located in Nigeria."""
import re, requests
from concurrent.futures import ThreadPoolExecutor
H = {"User-Agent": "Mozilla/5.0 JobAlert", "Accept": "application/json"}
NG = re.compile(r"nigeria|lagos|abuja|ikeja|lekki|port harcourt|ibadan|kano|enugu|\bng\b", re.I)
names = set("""renmoney fairmoney kuda kudabank moniepoint teamapt flutterwave paystack opay palmpay piggyvest cowrywise carbon
lidya aella branch interswitch paga quickteller remita systemspecs etranzact upperlink chams sterling sterlingbank accessbank
gtco gtbank zenith zenithbank wema wemabank providus fcmb ecobank stanbic stanbicibtc fidelity fidelitybank unionbank polaris
keystone firstbank uba heritage jaiz sunu leadway axamansard aiico cornerstone reliance reliancehmo hygeia avon avonhmo
jumia konga jiji chowdeck glovo bolt uber gokada moove lagosride treepz shuttlers kobo360 gig giglogistics sendbox shipbubble
kwik andela decagon semicolon alx alxafrica utiva altschool techstars cchub ventures platform norrenberger meristem cardinalstone
stanbicibtcpension arm armpension leadwaypensure trustfund crusader premiumpension
mtn mtnnigeria airtel airtelafrica glo 9mobile ipnx spectranet mainone rack centre rackcentre openserve
dangote bua flourmills nestle nestlenigeria unilever unilevernigeria cadbury pz pzcussons guinness diageo nigerianbreweries
heineken friesland frieslandcampina promasidor olam tolaram indomie dufil coca cola cocacola nbc sevenup pepsi
totalenergies shell seplat oando conoil mrs ardova nlng chevron exxon
kpmg kpmgnigeria pwc pwcnigeria deloitte deloittenigeria ey eynigeria accenture accenturenigeria sahara saharagroup
helium heliumhealth mdaas lifebank 54gene wellahealth reliancehealth healthplus medplus
bamboo risevest trove chaka cowrywise vfd vbank vfdgroup sparkle kippa brass prospa mono okra lendsqr indicina
seamlesshr workpay talentql eden edenlife lifeeden pricepally farmcrowdy thrive thriveagric afex
konga slot pointek kara jumiaforce wakanow travelstart
yellowcard busha quidax luno roqqu patricia bitnob
outsourceglobal hirequest workforce workforcegroup phillipsconsulting philipsconsulting pedabo jobberman myjobmag
transsion tecno infinix itel oppo samsung lg hisense
cellulant hubtel mpesa safaricom equity equitybank kcb ncba mtnghana vodacom mukuru chippercash wave""".split())
def get(u, **p):
    r = requests.get(u, params=p, headers=H, timeout=25); r.raise_for_status(); return r
def board(a):
    ats, s = a
    try:
        if ats == "breezy":
            jobs = [(j.get("name"), (j.get("location") or {}).get("name", "")) for j in get(f"https://{s}.breezy.hr/json").json()]
        elif ats == "smartrecruiters":
            d = get(f"https://api.smartrecruiters.com/v1/companies/{s}/postings", limit=100).json()["content"]
            jobs = [(j.get("name"), f'{(j.get("location") or {}).get("city","")} {(j.get("location") or {}).get("country","")}') for j in d]
        elif ats == "workable":
            d = get(f"https://apply.workable.com/api/v1/widget/accounts/{s}").json()["jobs"]
            jobs = [(j.get("title"), f'{j.get("city","")} {j.get("country","")}') for j in d]
        elif ats == "greenhouse":
            jobs = [(j["title"], (j.get("location") or {}).get("name", "")) for j in get(f"https://boards-api.greenhouse.io/v1/boards/{s}/jobs").json()["jobs"]]
        elif ats == "lever":
            jobs = [(j["text"], (j.get("categories") or {}).get("location", "") or "") for j in get(f"https://api.lever.co/v0/postings/{s}", mode="json").json()]
        else:
            jobs = [(j["title"], j.get("location", "")) for j in get(f"https://api.ashbyhq.com/posting-api/job-board/{s}").json()["jobs"]]
        ng = [j for j in jobs if NG.search(j[1] or "")]
        return (ats, s, len(jobs), len(ng), [t for t, _ in ng[:4]]) if ng else None
    except Exception:
        return None
res = [r for r in ThreadPoolExecutor(32).map(board, [(a, s) for s in names for a in ("breezy", "smartrecruiters", "workable", "greenhouse", "lever", "ashby")]) if r]
for r in sorted(res, key=lambda r: -r[3]):
    print(f"BOARD {r[0]}:{r[1]} total={r[2]} nigeria={r[3]} | " + " ; ".join(r[4]))
print("TOTAL", len(res), "boards,", sum(r[3] for r in res), "jobs in Nigeria")
