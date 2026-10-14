"""Finds jobs for one subscriber's preferences and ranks them.

Remote jobs (no keys needed): Himalayas, Jobicy, Remotive, We Work Remotely, RemoteOK,
Working Nomads, Arbeitnow, The Muse and Jobspresso.
Jooble (optional free key JOOBLE_API_KEY) searches thousands of sites, like Indeed, remote and on-site.
On-site/hybrid jobs (optional keys): Adzuna (19 countries, free key at
developer.adzuna.com: ADZUNA_APP_ID + ADZUNA_APP_KEY) and Reed (UK, free key:
REED_API_KEY). Without those keys, on-site coverage is thin, so the form
encourages remote searches.

Every job sent has passed: location fits the subscriber, posted in the last
7 days (older adverts already have a pile of applicants), seniority fits, paid and no common scam signs, not past the board's
expiry date, and its link doesn't come back "not found".
"""
import os
import re
import time
import xml.etree.ElementTree as ET
from collections import Counter
from difflib import get_close_matches
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from functools import lru_cache
from html import unescape
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import requests

TIMEOUT = 20
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; JobAlertsBot/1.0)"}
MAX_AGE = timedelta(days=7)

# name: (ISO code, Adzuna code or "", regions the country belongs to)
COUNTRIES = {
    "Nigeria": ("NG", "", ["africa", "emea"]), "Ghana": ("GH", "", ["africa", "emea"]),
    "Kenya": ("KE", "", ["africa", "emea"]), "South Africa": ("ZA", "za", ["africa", "emea"]),
    "Egypt": ("EG", "", ["africa", "emea", "middle east"]), "United Kingdom": ("GB", "gb", ["europe", "emea", "uk"]),
    "Ireland": ("IE", "", ["europe", "emea"]), "Germany": ("DE", "de", ["europe", "emea"]),
    "France": ("FR", "fr", ["europe", "emea"]), "Netherlands": ("NL", "nl", ["europe", "emea"]),
    "Spain": ("ES", "es", ["europe", "emea"]), "Italy": ("IT", "it", ["europe", "emea"]),
    "Poland": ("PL", "pl", ["europe", "emea"]), "Portugal": ("PT", "", ["europe", "emea"]),
    "United Arab Emirates": ("AE", "", ["middle east", "emea"]), "Saudi Arabia": ("SA", "", ["middle east", "emea"]),
    "India": ("IN", "in", ["asia", "apac"]), "Pakistan": ("PK", "", ["asia", "apac"]),
    "Philippines": ("PH", "", ["asia", "apac"]), "Singapore": ("SG", "sg", ["asia", "apac"]),
    "Australia": ("AU", "au", ["apac", "oceania"]), "New Zealand": ("NZ", "nz", ["apac", "oceania"]),
    "United States": ("US", "us", ["americas", "north america", "usa"]), "Canada": ("CA", "ca", ["americas", "north america"]),
    "Mexico": ("MX", "mx", ["americas", "latam"]), "Brazil": ("BR", "br", ["americas", "latam"]),
}
ALIASES = {"United Kingdom": ["uk", "great britain", "england"], "United States": ["usa", "u.s.", "us only", "united states"],
           "United Arab Emirates": ["uae", "dubai"]}
ANYWHERE = ["worldwide", "anywhere", "global", "remote (any", "all countries"]

TOO_SENIOR = {"entry": ["senior", "sr.", "sr ", "lead ", "head of", "director", "principal", "manager", "chief", "vp ", "vice president"],
              "mid": ["head of", "director", "chief", "vp ", "vice president", "principal"]}
ENTRY_SIGNS = ["entry", "junior", "graduate", "trainee", "no experience", "intern"]
UNPAID = ["volunteer", "unpaid", "commission only", "commission-only", "equity only"]
SCAM_SIGNS = ["registration fee", "training fee", "pay a fee", "processing fee", "starter kit", "telegram",
              "whatsapp", "google hangouts", "wire transfer", "send money", "western union", "no interview",
              "unlimited earning"]
REMOTE_WORDS = ["remote", "work from home", "home based", "home-based", "anywhere"]


def _clean(html_text: str) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", html_text or ""))).strip()


def _get(url: str, **params):
    r = requests.get(url, params=params, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()


def _raw(title, company, location, url, source, posted, desc, remote, level="", pay="", job_type="",
         pay_month=None) -> dict:
    return {"title": (title or "").strip(), "company": (company or "").strip(), "location": location or "",
            "url": url or "", "source": source, "posted": posted, "desc": desc or "", "remote": remote,
            "level": level or "", "pay": pay or "", "job_type": job_type or "", "pay_month": pay_month}


def _num(x) -> float:
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        return 0.0


def _pay(lo, hi, currency, period) -> str:
    lo, hi = _num(lo), _num(hi)
    if not (lo or hi) or not currency:
        return ""
    rng = f"{lo:,.0f}-{hi:,.0f}" if lo and hi and lo != hi else f"{(lo or hi):,.0f}"
    return f"{currency} {rng}/{(period or '').replace('ly', '').replace('annual', 'year') or 'period'}"


PER_MONTH = {"year": 1 / 12, "annual": 1 / 12, "month": 1, "week": 52 / 12, "day": 21.7, "hour": 160}


def _monthly(lo, hi, currency, period) -> tuple[float, str] | None:
    """(pay per month, currency), from the middle of the range, for showing it in naira."""
    lo, hi = _num(lo), _num(hi)
    amount = (lo + hi) / 2 if lo and hi else (lo or hi)
    if not amount or not currency:
        return None
    period = (period or "").lower()
    factor = next((f for p, f in PER_MONTH.items() if p in period), 1 / 12 if amount > 20000 else 1)
    return amount * factor, currency.upper()


@lru_cache(maxsize=1)
def _rates() -> dict:
    """Exchange rates against USD (free, no key). Empty if unavailable: then naira just isn't shown."""
    try:
        return _get("https://open.er-api.com/v6/latest/USD").get("rates") or {}
    except Exception as e:
        print(f"[rates] skipped: {e}")
        return {}


def in_naira(pay_month: tuple[float, str] | None) -> str:
    """"≈ ₦2.3m a month", or "" when the amount or the rate is unknown."""
    if not pay_month:
        return ""
    amount, currency = pay_month
    rates = _rates()
    if currency == "NGN" or not rates.get("NGN") or not rates.get(currency):
        return ""
    ngn = amount * rates["NGN"] / rates[currency]
    if ngn < 1000:
        return ""
    short = f"{ngn / 1e6:.1f}m".replace(".0m", "m") if ngn >= 1e6 else f"{ngn / 1e3:.0f}k"
    return f"≈ ₦{short} a month"


def _in_country(place: str | None, country: str) -> str:
    """Adzuna/Reed search one country, so name it in the location ("Leeds" -> "Leeds, United Kingdom")."""
    place = (place or "").strip()
    return place if country.lower() in place.lower() else ", ".join(p for p in (place, country) if p)


# --- sources (each cached per run, so many subscribers with the same search cost one call) ---

@lru_cache(maxsize=None)
def from_himalayas(keyword: str, country: str) -> tuple:
    out = []
    try:
        params = {"q": keyword, "sort": "recent"}
        if country:
            params["country"] = COUNTRIES.get(country, (country,))[0]
        for j in _get("https://himalayas.app/jobs/api/search", **params).get("jobs", []):
            if j.get("expiryDate") and j["expiryDate"] < time.time():
                continue
            out.append(_raw(
                j.get("title"), j.get("companyName"), ", ".join(j.get("locationRestrictions") or []) or "Worldwide",
                j.get("applicationLink"), "Himalayas",
                datetime.fromtimestamp(j["pubDate"], timezone.utc) if j.get("pubDate") else None,
                _clean(j.get("description") or j.get("excerpt")), True, ", ".join(j.get("seniority") or []),
                _pay(j.get("minSalary"), j.get("maxSalary"), j.get("currency"), j.get("salaryPeriod")),
                j.get("employmentType"),
                _monthly(j.get("minSalary"), j.get("maxSalary"), j.get("currency"), j.get("salaryPeriod"))))
        time.sleep(1)
    except Exception as e:
        print(f"[Himalayas:{keyword}] skipped: {e}")
    return tuple(out)


@lru_cache(maxsize=None)
def from_jobicy(keyword: str) -> tuple:
    out = []
    try:
        for j in _get("https://jobicy.com/api/v2/remote-jobs", count=100, tag=keyword).get("jobs", []):
            out.append(_raw(
                unescape(j.get("jobTitle", "")), j.get("companyName"), j.get("jobGeo") or "Anywhere", j.get("url"),
                "Jobicy", datetime.fromisoformat(j["pubDate"]) if j.get("pubDate") else None,
                _clean(j.get("jobExcerpt") or j.get("jobDescription")), True, j.get("jobLevel"),
                _pay(j.get("salaryMin"), j.get("salaryMax"), j.get("salaryCurrency"), j.get("salaryPeriod")),
                str(j.get("jobType") or ""),
                _monthly(j.get("salaryMin"), j.get("salaryMax"), j.get("salaryCurrency"), j.get("salaryPeriod"))))
        time.sleep(1)
    except Exception as e:
        print(f"[Jobicy:{keyword}] skipped: {e}")
    return tuple(out)


# Whole-feed sources: fetched once per run and matched against every subscriber's job titles.

@lru_cache(maxsize=1)
def from_remotive() -> tuple:
    out = []
    try:
        for j in _get("https://remotive.com/api/remote-jobs").get("jobs", []):
            posted = j.get("publication_date")
            out.append(_raw(
                j.get("title"), j.get("company_name"), j.get("candidate_required_location"), j.get("url"), "Remotive",
                datetime.fromisoformat(posted).replace(tzinfo=timezone.utc) if posted else None,
                _clean(j.get("description")), True, pay=j.get("salary") or "", job_type=j.get("job_type") or ""))
    except Exception as e:
        print(f"[Remotive] skipped: {e}")
    return tuple(out)


@lru_cache(maxsize=1)
def from_weworkremotely() -> tuple:
    out = []
    try:
        r = requests.get("https://weworkremotely.com/remote-jobs.rss", headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        for item in ET.fromstring(r.content).iter("item"):
            company, _, title = (item.findtext("title") or "").partition(": ")
            if not title:
                company, title = "", company
            posted = item.findtext("pubDate")
            out.append(_raw(
                title, company, item.findtext("region") or "Anywhere", item.findtext("link"), "We Work Remotely",
                parsedate_to_datetime(posted) if posted else None, _clean(item.findtext("description")), True,
                job_type=item.findtext("type") or ""))
    except Exception as e:
        print(f"[We Work Remotely] skipped: {e}")
    return tuple(out)


@lru_cache(maxsize=1)
def from_remoteok() -> tuple:
    out = []
    try:
        for j in _get("https://remoteok.com/api"):
            if not isinstance(j, dict) or not j.get("position"):
                continue  # the first entry is RemoteOK's terms notice
            lo, hi = j.get("salary_min"), j.get("salary_max")
            out.append(_raw(
                j.get("position"), j.get("company"), j.get("location") or "Worldwide", j.get("url") or j.get("apply_url"),
                "RemoteOK", datetime.fromisoformat(j["date"]) if j.get("date") else None, _clean(j.get("description")),
                True, pay=_pay(lo, hi, "USD", "year"), pay_month=_monthly(lo, hi, "USD", "year")))
    except Exception as e:
        print(f"[RemoteOK] skipped: {e}")
    return tuple(out)


@lru_cache(maxsize=1)
def from_workingnomads() -> tuple:
    out = []
    try:
        for j in _get("https://www.workingnomads.com/api/exposed_jobs/"):
            posted = j.get("pub_date")
            out.append(_raw(
                j.get("title"), j.get("company_name"), j.get("location") or "Anywhere", j.get("url"), "Working Nomads",
                datetime.fromisoformat(posted) if posted else None, _clean(j.get("description")), True))
    except Exception as e:
        print(f"[Working Nomads] skipped: {e}")
    return tuple(out)


@lru_cache(maxsize=1)
def from_arbeitnow() -> tuple:
    """Mostly Europe; only its remote jobs are used."""
    out = []
    try:
        for j in _get("https://www.arbeitnow.com/api/job-board-api").get("data", []):
            if not j.get("remote"):
                continue
            out.append(_raw(
                j.get("title"), j.get("company_name"), j.get("location") or "", j.get("url"), "Arbeitnow",
                datetime.fromtimestamp(j["created_at"], timezone.utc) if j.get("created_at") else None,
                _clean(j.get("description")), True, job_type=", ".join(j.get("job_types") or [])))
    except Exception as e:
        print(f"[Arbeitnow] skipped: {e}")
    return tuple(out)


@lru_cache(maxsize=1)
def from_themuse() -> tuple:
    """The Muse: its remote ("Flexible / Remote") jobs, newest first, a few pages."""
    out = []
    try:
        for page in range(1, 6):
            data = _get("https://www.themuse.com/api/public/jobs", page=page, location="Flexible / Remote", descending="true")
            for j in data.get("results", []):
                posted = j.get("publication_date")
                out.append(_raw(
                    j.get("name"), (j.get("company") or {}).get("name"),
                    ", ".join(l.get("name", "") for l in j.get("locations") or []) or "Flexible / Remote",
                    (j.get("refs") or {}).get("landing_page"), "The Muse",
                    datetime.fromisoformat(posted.replace("Z", "+00:00")) if posted else None,
                    _clean(j.get("contents")), True, ", ".join(l.get("name", "") for l in j.get("levels") or [])))
            if page >= (data.get("page_count") or 0):
                break
            time.sleep(1)
    except Exception as e:
        print(f"[The Muse] skipped: {e}")
    return tuple(out)


def _rss(url: str, source: str, location: str = "Anywhere") -> tuple:
    """Remote job boards that publish an RSS feed of their latest jobs ("Company: Title" or plain titles)."""
    out = []
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        for item in ET.fromstring(r.content).iter("item"):
            title, company = (item.findtext("title") or "").strip(), ""
            for el in item:  # namespaced extras some boards add, e.g. <job_listing:company>
                tag = el.tag.rsplit("}", 1)[-1].lower()
                if tag in ("company", "company_name", "companyname") and el.text:
                    company = el.text.strip()
                elif tag in ("location", "region") and el.text:
                    location = el.text.strip()
            if not company and " at " in title:
                title, _, company = title.rpartition(" at ")
            posted = item.findtext("pubDate")
            out.append(_raw(title, company, location, item.findtext("link"), source,
                            parsedate_to_datetime(posted) if posted else None, _clean(item.findtext("description")), True))
    except Exception as e:
        print(f"[{source}] skipped: {e}")
    return tuple(out)


@lru_cache(maxsize=1)
def from_jobspresso() -> tuple:
    return _rss("https://jobspresso.co/feed/?post_type=job_listing", "Jobspresso")


def remote_feeds() -> tuple:
    return (from_remotive() + from_weworkremotely() + from_remoteok() + from_workingnomads() + from_arbeitnow()
            + from_themuse() + from_jobspresso())


@lru_cache(maxsize=None)
def from_jooble(keyword: str, where: str) -> tuple:
    """Jooble: a job search engine like Indeed that gathers adverts from thousands of sites, including
    Nigerian ones. Needs a free key (JOOBLE_API_KEY, from jooble.org/api/about). `where` is a country or
    city for on-site searches, or "" for remote."""
    key = os.environ.get("JOOBLE_API_KEY", "").strip()
    if not key:
        return ()
    out = []
    try:
        r = requests.post(f"https://jooble.org/api/{key}", json={"keywords": keyword if where else f"{keyword} remote",
                          "location": where, "page": "1"}, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        for j in r.json().get("jobs", []):
            loc, text = j.get("location") or "", f"{j.get('title', '')} {j.get('location', '')} {j.get('snippet', '')}".lower()
            remote = any(w in text for w in REMOTE_WORDS)
            posted = j.get("updated")
            out.append(_raw(
                _clean(j.get("title")), j.get("company"), loc, j.get("link"), f"Jooble ({j['source']})" if j.get("source") else "Jooble",
                datetime.fromisoformat(posted[:19]).replace(tzinfo=timezone.utc) if posted else None,
                _clean(j.get("snippet")), remote, pay=j.get("salary") or "", job_type=j.get("type") or ""))
        time.sleep(1)
    except Exception as e:
        print(f"[Jooble:{keyword}] skipped: {e}")
    return tuple(out)


@lru_cache(maxsize=None)
def from_adzuna(keyword: str, country: str, city: str = "") -> tuple:
    app_id, app_key = os.environ.get("ADZUNA_APP_ID"), os.environ.get("ADZUNA_APP_KEY")
    code = COUNTRIES.get(country, ("", "", []))[1]
    if not (app_id and app_key and code):
        return ()
    out = []
    try:
        params = {"app_id": app_id, "app_key": app_key, "what": keyword, "results_per_page": 50,
                  "max_days_old": 7, "sort_by": "date"}
        if city:
            params.update(where=city, distance=25)  # km around their preferred area
        data = _get(f"https://api.adzuna.com/v1/api/jobs/{code}/search/1", **params)
        for j in data.get("results", []):
            desc = _clean(j.get("description"))
            out.append(_raw(
                _clean(j.get("title")), (j.get("company") or {}).get("display_name"),
                _in_country((j.get("location") or {}).get("display_name"), country), j.get("redirect_url"), "Adzuna",
                datetime.fromisoformat(j["created"].replace("Z", "+00:00")) if j.get("created") else None,
                desc, any(w in f"{j.get('title', '')} {desc}".lower() for w in REMOTE_WORDS),
                pay=f"{j['salary_min']:,.0f}+ a year" if j.get("salary_min") else "", job_type=j.get("contract_time") or ""))
    except Exception as e:
        print(f"[Adzuna:{keyword}/{code}] skipped: {e}")
    return tuple(out)


@lru_cache(maxsize=None)
def from_reed(keyword: str, city: str = "") -> tuple:
    key = os.environ.get("REED_API_KEY")
    if not key:
        return ()
    out = []
    try:
        r = requests.get("https://www.reed.co.uk/api/1.0/search", params={"keywords": keyword, "resultsToTake": 50,
                                                                         **({"locationName": city, "distanceFromLocation": 15} if city else {})},
                         auth=(key, ""), headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        for j in r.json().get("results", []):
            desc = _clean(j.get("jobDescription"))
            posted = j.get("date")
            out.append(_raw(
                j.get("jobTitle"), j.get("employerName"), _in_country(j.get("locationName"), "United Kingdom"), j.get("jobUrl"),
                "Reed", datetime.strptime(posted, "%d/%m/%Y").replace(tzinfo=timezone.utc) if posted else None,
                desc, any(w in f"{j.get('jobTitle', '')} {desc}".lower() for w in REMOTE_WORDS),
                pay=f"GBP {j['minimumSalary']:,.0f}+" if j.get("minimumSalary") else "",
                pay_month=_monthly(j.get("minimumSalary"), j.get("maximumSalary"), "GBP", "year")))
    except Exception as e:
        print(f"[Reed:{keyword}] skipped: {e}")
    return tuple(out)


# --- matching ---

# Job titles that mean the same thing. Searching for any one also finds the others.
RELATED = [
    ["public relations", "pr", "communications", "comms", "media relations", "press officer", "publicist"],
    ["virtual assistant", "va", "executive assistant", "personal assistant", "administrative assistant", "admin assistant"],
    ["customer support", "customer service", "customer success", "customer care", "support agent", "support specialist"],
    ["social media", "social media manager", "community manager", "social media marketing"],
    ["content writer", "copywriter", "writer", "content creator", "content marketing", "blog writer"],
    ["data analyst", "data analytics", "business intelligence", "bi analyst", "reporting analyst"],
    ["software engineer", "software developer", "full stack", "fullstack", "backend developer", "backend engineer",
     "frontend developer", "frontend engineer", "web developer"],
    ["graphic designer", "visual designer", "brand designer"],
    ["ux designer", "ui designer", "ui/ux", "ux/ui", "product designer"],
    ["accountant", "bookkeeper", "accounting", "accounts assistant"],
    ["project manager", "project coordinator", "program coordinator", "delivery manager"],
    ["digital marketing", "marketing", "growth marketing", "performance marketing", "marketing specialist"],
    ["sales", "sales representative", "business development", "sdr", "bdr", "account executive"],
    ["hr", "human resources", "recruiter", "talent acquisition", "people operations"],
    ["product manager", "product owner"],
    ["teacher", "tutor", "online tutor", "english teacher", "esl teacher"],
    ["data entry", "data entry clerk", "data entry specialist"],
    ["video editor", "video producer", "motion designer"],
    ["seo", "seo specialist", "seo manager"],
    ["qa", "qa tester", "quality assurance", "software tester", "test engineer"],
    ["transcription", "transcriber", "transcriptionist"],
    ["data annotation", "ai annotation", "data annotator", "data labeling", "ai trainer", "ai training", "ai data trainer"],
    ["lead generation", "appointment setter", "cold caller", "telemarketer", "lead generation specialist"],
    ["telemedicine", "telehealth", "medical assistant", "medical scribe", "medical virtual assistant", "medical billing"],
    ["live chat", "chat support", "chat agent"],
    ["email marketing", "email marketer", "email marketing specialist"],
    ["ai automation", "automation specialist", "automation engineer", "no-code developer"],
    ["operations associate", "operations assistant", "operations coordinator", "operations specialist"],
]

# Neighbouring jobs: when someone's own titles don't fill their daily minimum, these are the next
# closest roles (by the first title of each RELATED group) that the same person could apply for.
NEIGHBOURS = {
    "public relations": ["content writer", "social media", "digital marketing"],
    "virtual assistant": ["customer support", "operations associate", "data entry", "live chat"],
    "customer support": ["live chat", "virtual assistant", "sales"],
    "social media": ["content writer", "digital marketing", "video editor"],
    "content writer": ["social media", "seo", "email marketing", "public relations"],
    "data analyst": ["data entry", "qa", "operations associate"],
    "software engineer": ["qa", "ai automation"],
    "graphic designer": ["ux designer", "video editor", "social media"],
    "ux designer": ["graphic designer", "product manager"],
    "accountant": ["data entry", "virtual assistant", "operations associate"],
    "project manager": ["operations associate", "product manager", "virtual assistant"],
    "digital marketing": ["seo", "email marketing", "social media", "content writer"],
    "sales": ["lead generation", "customer support"],
    "hr": ["virtual assistant", "operations associate"],
    "product manager": ["project manager", "ux designer"],
    "teacher": ["content writer", "transcription", "data annotation"],
    "data entry": ["transcription", "data annotation", "virtual assistant"],
    "video editor": ["graphic designer", "social media"],
    "seo": ["content writer", "digital marketing"],
    "qa": ["data annotation", "software engineer"],
    "transcription": ["data entry", "data annotation"],
    "data annotation": ["data entry", "transcription", "qa"],
    "lead generation": ["sales", "customer support"],
    "telemedicine": ["virtual assistant", "customer support", "transcription"],
    "live chat": ["customer support", "virtual assistant"],
    "email marketing": ["digital marketing", "content writer"],
    "ai automation": ["software engineer", "data annotation"],
    "operations associate": ["virtual assistant", "project manager"],
}

# What people type that should search for something more useful. "any" means they'd take most entry-level remote work.
BROAD = ["virtual assistant", "customer support", "data entry"]
VAGUE = {"any", "anything", "all", "any job", "any jobs", "anything remote", "remote", "online", "work from home"}
# Common shorthands and misspellings that fuzzy matching alone gets wrong.
ALIASES = {"customer": "customer support", "tele medicine": "telemedicine", "tele medcine": "telemedicine",
           "telemedcine": "telemedicine", "admin": "administrative assistant", "assistant": "virtual assistant",
           "teaching assistant": "teacher", "online tutoring": "online tutor", "tutoring": "tutor",
           "customer support agent": "customer support", "customer service agent": "customer service",
           "content creation": "content creator", "copy writing": "copywriter", "copywriting": "copywriter",
           "social media management": "social media manager", "graphics design": "graphic designer",
           "graphic design": "graphic designer",
           "visual assistant": "virtual assistant", "visual assistance": "virtual assistant",
           "virtual assistance": "virtual assistant"}
_VOCAB = sorted({t for group in RELATED for t in group} | set(ALIASES))


def clean_title(raw: str) -> list[str]:
    """One typed job title -> the title(s) to search for: tidied, typos fixed, joined titles split,
    and vague words like "any" swapped for broad entry-level titles."""
    t = re.sub(r"\s+", " ", raw.strip().lower())
    t = re.sub(r"\b(jobs?|roles?|positions?|remote|work)\b", " ", t)
    t = re.sub(r"\s+", " ", t).strip(" .-")
    if raw.strip().lower() in VAGUE or t in VAGUE or not t:
        return list(BROAD) if raw.strip() else []
    parts = [p.strip() for p in re.split(r"\s+(?:and|&|/)\s+|\s*/\s*", t) if p.strip()]
    if len(parts) > 1:
        return [x for p in parts for x in clean_title(p)]
    if t in ALIASES:
        return [ALIASES[t]]
    if t in _VOCAB:
        return [t]
    if len(t) < 3:  # "ai" or "it" alone would match far too much; real short titles (pr, va, hr) are in _VOCAB
        return []
    close = get_close_matches(t, _VOCAB, n=1, cutoff=0.85)
    return [ALIASES.get(close[0], close[0])] if close else [t]


def clean_keywords(keywords_csv: str) -> list[str]:
    """A subscriber's titles, cleaned, without duplicates, in the order they typed them."""
    out: list[str] = []
    for raw in (keywords_csv or "").split(","):
        for t in clean_title(raw):
            if t not in out:
                out.append(t)
    return out


def neighbours(keywords: list[str]) -> list[str]:
    """Next-closest titles for someone's titles, nearest first, then the broad entry-level ones."""
    out: list[str] = []
    for k in keywords:
        group = next((g for g in RELATED if k in g), None)
        out += NEIGHBOURS.get(group[0], []) if group else []
    taken = {t for k in keywords for g in RELATED if k in g for t in g} | set(keywords)
    return [t for t in dict.fromkeys(out + BROAD) if t not in taken]


def variants(keyword: str) -> list[str]:
    """The keyword itself first, then the titles related to it."""
    k = keyword.strip().lower()
    for group in RELATED:
        if k in group:
            return [k] + [g for g in group if g != k]
    return [k]


@lru_cache(maxsize=4096)
def _title_re(phrase: str) -> re.Pattern:
    # Whole words only, so "pr" doesn't match "product"; plurals allowed ("assistants").
    return re.compile(rf"(?<![a-z0-9]){re.escape(phrase)}s?(?![a-z0-9])")


def title_hit(title: str, keywords: list[str]) -> str | None:
    """Which of the subscriber's keywords this job title matches, directly or through a related title."""
    title = title.lower()
    for k in keywords:
        if _title_re(k).search(title):
            return k
    for k in keywords:
        if any(_title_re(v).search(title) for v in variants(k)[1:]):
            return k
    return None

def location_fits(job_location: str, country: str, remote: bool) -> bool:
    """Can someone in `country` take this job?"""
    if not country:
        return True
    loc = job_location.lower()
    if not loc or any(w in loc for w in ANYWHERE):
        return True
    names = [country.lower()] + ALIASES.get(country, [])
    if any(n in loc for n in names):
        return True
    # Remote jobs open to a region the person lives in ("EMEA", "Africa"...)
    return remote and any(r in loc for r in COUNTRIES.get(country, ("", "", []))[2])


# Remote adverts that are really limited to one country or region ("must be based in the US",
# "authorized to work in the UK"...). place pattern -> countries it allows.
_PLACES = {
    r"(?:the )?(?:u\.s\.a?\.?|usa|united states|us)": {"United States"},
    r"(?:the )?(?:u\.k\.?|uk|united kingdom|great britain|england)": {"United Kingdom"},
    r"canada": {"Canada"},
    r"(?:the )?(?:eu|european union|europe|eea)": {c for c, v in COUNTRIES.items() if "europe" in v[2]},
    r"australia": {"Australia"}, r"india": {"India"}, r"germany": {"Germany"}, r"latin america|latam": {
        c for c, v in COUNTRIES.items() if "latam" in v[2]},
}
_LIMITS = [
    r"\b(?:must|need to|needs to|required to|should) (?:be )?(?:currently )?(?:based|located|living|residing|resident|reside) in {p}\b",
    r"\b(?:candidates|applicants) (?:must be )?(?:based|located|residing) in {p}\b",
    r"\b(?:authori[sz]ed|eligible|legally able|permitted) to work in {p}\b",
    r"\bright to work in {p}\b",
    r"\b{p}[- ](?:based )?(?:candidates|applicants|residents|citizens) only\b",
    r"\bonly (?:open to|accepting|hiring) (?:candidates |applicants )?(?:in|from|based in) {p}\b",
]
_LIMIT_RES = [(re.compile(t.format(p=f"(?:{place})")), allowed) for place, allowed in _PLACES.items() for t in _LIMITS]
_CITIZENS = re.compile(r"\b(?:us|u\.s\.) citizen(?:s|ship)?\b|\bsecurity clearance\b|\bw-2\b")


def open_to(job: dict, country: str) -> bool:
    """False when the advert says it only hires from places that don't include `country`."""
    if not country or not job["remote"]:
        return True
    text = f"{job['title']} {job['location']} {job['desc']}".lower()
    if country != "United States" and _CITIZENS.search(text):
        return False
    return all(country in allowed for rx, allowed in _LIMIT_RES if rx.search(text))


def says_open_to(job: dict, country: str) -> bool:
    """True when the listing explicitly names the country, one of its regions, or worldwide."""
    loc = job["location"].lower()
    names = [country.lower()] + ALIASES.get(country, []) + COUNTRIES.get(country, ("", "", []))[2]
    return any(n in loc for n in names) or any(w in loc for w in ANYWHERE)


def score(job: dict, keywords: list[str], country: str, remote_only: bool, level: str,
          city: str = "", why: Counter | None = None) -> tuple[int, list[str]] | None:
    """Returns (score, reasons), or None if the job fails a check (counted in `why` by reason)."""
    def no(reason):
        if why is not None:
            why[reason] += 1
        return None

    title, text = job["title"].lower(), f"{job['title']} {job['desc']}".lower()
    hit = title_hit(title, keywords)
    if not hit:
        return no("title doesn't match")
    if not job["url"] or not job["posted"]:
        return no("no link or date")
    if datetime.now(timezone.utc) - job["posted"] > MAX_AGE:
        return no("too old")
    if remote_only and not job["remote"]:
        return no("not remote")
    if not location_fits(job["location"], country, job["remote"]) or not open_to(job, country):
        return no("not open to their country")
    if level in TOO_SENIOR and (any(w in f" {title} " for w in TOO_SENIOR[level])
                                or job["level"].lower() in ("senior", "manager", "director", "executive")):
        return no("too senior")
    if any(w in f"{title} {job['job_type']}".lower() for w in UNPAID) or any(w in text for w in SCAM_SIGNS):
        return no("unpaid or scam signs")

    pts, reasons = 10, [f"matches \"{hit}\"", f"{'remote, ' if job['remote'] else ''}{job['location'] or 'location not stated'}"]
    if country and job["remote"] and says_open_to(job, country):
        pts += 1
        reasons.insert(0, f"open to {country}")
    if level == "entry" and ("entry" in job["level"].lower() or any(w in text for w in ENTRY_SIGNS)):
        pts += 3
        reasons.append("entry-level")
    if job["pay"]:
        pts += 2
        reasons.append(job["pay"])
    if country and country.lower() in job["location"].lower():
        pts += 2  # explicitly hiring in their country, not just "worldwide"
    if not remote_only and not job["remote"]:
        pts += 4  # they asked for on-site/hybrid near them, so local jobs come first
        if city and city.lower() in job["location"].lower():
            pts += 2
    pts += max(0, 3 - (datetime.now(timezone.utc) - job["posted"]).days // 2)  # newest first: fewer applicants yet
    reasons.append(f"posted {job['posted']:%d %b}")
    return pts, reasons


def _link_ok(url: str) -> bool:
    try:
        return requests.get(url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True).status_code not in (404, 410)
    except Exception:
        return False


def _words(s: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", (s or "").lower()))


TRACKING = {"ref", "referrer", "source", "src", "fbclid", "gclid", "mc_cid", "mc_eid"}


def _clean_url(url: str) -> str:
    """Drops tracking parameters, so the same advert isn't seen as new because its link changed."""
    parts = urlsplit((url or "").strip())
    query = [(k, v) for k, v in parse_qsl(parts.query) if not (k.lower().startswith("utm_") or k.lower() in TRACKING)]
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip("/"), urlencode(query), ""))


def job_keys(job: dict) -> set[str]:
    """Ways we recognise a job we've sent before: its link, and its title + company (the same
    advert is often on several job boards under different links)."""
    keys = {f"t:{_words(job['title'])}|{_words(job['company'])}"}
    if job.get("url"):
        keys |= {job["url"], _clean_url(job["url"])}
    return keys


def job_key(job: dict) -> str:
    """One stored value per job that holds both its title + company and its link."""
    title_key = f"t:{_words(job['title'])}|{_words(job['company'])}"
    return f"{title_key}\t{_clean_url(job.get('url') or '')}"[:500]


def sent_keys(stored: set[str]) -> set[str]:
    """Expands stored job_key values (including older ones that were just a link) for matching."""
    return {part for value in stored for part in value.split("\t") if part}


def _search(keywords: list[str], country: str, remote_only: bool, level: str, city: str,
            seen: set[str], why: Counter) -> tuple[list[dict], Counter]:
    """Every listing that passes the checks for these titles, best first, plus how many listings each board gave."""
    pool = list(remote_feeds())
    for k in keywords:
        pool += from_himalayas(k, country) + from_jobicy(k) + from_jooble(k, "" if remote_only else (city or country))
        if not remote_only:
            pool += from_adzuna(k, country, city) + (from_reed(k, city) if country == "United Kingdom" else ())
    ranked = []
    for job in pool:
        keys = job_keys(job)
        if keys & seen:
            why["already sent or duplicate"] += 1
            continue
        result = score(job, keywords, country, remote_only, level, city, why)
        if result:
            seen |= keys
            matched = list(result[1])
            if country == "Nigeria" and job["pay"] and (naira := in_naira(job.get("pay_month"))):
                matched = [f"{m} ({naira})" if m == job["pay"] else m for m in matched]
            ranked.append({**job, "score": result[0], "matched": matched, "hit": title_hit(job["title"], keywords)})
    ranked.sort(key=lambda j: j["score"], reverse=True)
    return ranked, Counter(j["source"].split(" (")[0] for j in pool)


def _pick(ranked: list[dict], keywords: list[str], n: int) -> list[dict]:
    """Up to n working jobs, taking turns between the titles so one busy title doesn't fill every email."""
    picked, used = [], {k: 0 for k in keywords}
    while len(picked) < n and ranked:
        fewest = min(used[j["hit"]] for j in ranked)
        job = next(j for j in ranked if used[j["hit"]] == fewest)
        ranked.remove(job)
        if _link_ok(job["url"]):
            picked.append(job)
            used[job["hit"]] += 1
    return picked


def find_jobs(keywords_csv: str, country: str, remote_only: bool, level: str, exclude: set[str], n: int = 5,
              city: str = "", minimum: int = 0) -> list[dict]:
    """remote_only=True searches remote jobs. False means on-site/hybrid near `city` (via Adzuna/Reed),
    with remote jobs as a fallback.

    Up to `n` jobs for their own titles. If that's fewer than `minimum`, the gap is filled from the
    next-closest roles (NEIGHBOURS, then the broad entry-level titles), marked "similar role". Every job
    still passes every check: last 7 days, open to their country, seniority, scam signs, never sent before."""
    keywords = clean_keywords(keywords_csv)[:5]
    seen, why = sent_keys(exclude), Counter()
    ranked, boards = _search(keywords, country, remote_only, level, city, seen, why)
    matched = len(ranked)
    picked = _pick(ranked, keywords, n)
    extra = 0
    if len(picked) < minimum and (near := neighbours(keywords)):
        more, _ = _search(near, country, remote_only, level, city, seen, Counter())
        for j in more:
            j["matched"] = ["similar role"] + j["matched"]
        more.sort(key=lambda j: (near.index(j["hit"]), -j["score"]))  # closest roles first
        found = []
        for j in more:
            if len(picked) + len(found) >= minimum:
                break
            if _link_ok(j["url"]):
                found.append(j)
        extra = len(found)
        picked += found
    print(f"  checked {sum(boards.values())} listings ({', '.join(f'{s} {c}' for s, c in boards.most_common())}), "
          f"{matched} matched, picked {len(picked)}{f' ({extra} from similar roles to reach the daily minimum)' if extra else ''}; "
          f"left out: {', '.join(f'{c} {r}' for r, c in why.most_common()) or 'none'}")
    return picked


if __name__ == "__main__":
    # Preview without a database or email:  python -m job_alerts.search "virtual assistant, pr" Nigeria entry
    import sys
    kw, where, lvl = (sys.argv[1:] + ["", "", "any"])[:3]
    for j in find_jobs(kw or "virtual assistant", where, True, lvl or "any", set()):
        print(f"- {j['title']} | {j['company']} | {', '.join(j['matched'])} | {j['url']}")
