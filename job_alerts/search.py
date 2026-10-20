"""Finds jobs for one subscriber's preferences and ranks them.

Remote jobs (no keys needed): the careers pages of about 1,000 companies on Greenhouse, Lever,
Ashby, Workable and Recruitee (CAREER_PAGES + career_pages.json), plus Working Nomads,
Arbeitnow, The Muse and Jobspresso. Every one lets people apply without a job-board account.
Jooble (optional free key JOOBLE_API_KEY) searches thousands of sites, like Indeed, remote and on-site.
On-site/hybrid jobs (optional keys): Adzuna (19 countries, free key at
developer.adzuna.com: ADZUNA_APP_ID + ADZUNA_APP_KEY) and Reed (UK, free key:
REED_API_KEY). Without those keys, on-site coverage is thin, so the form
encourages remote searches.

Every job sent has passed: location fits the subscriber, posted in the last
7 days (older adverts already have a pile of applicants), seniority fits, paid and no common scam signs, not past the board's
expiry date, and its link doesn't come back "not found".
"""
import gzip
import json
import os
import pickle
import re
import time
import xml.etree.ElementTree as ET
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from difflib import get_close_matches
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from functools import lru_cache
from html import unescape
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import requests

from . import ai_match

TIMEOUT = 20
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; JobAlertsBot/1.0)"}
MAX_AGE = timedelta(days=7)
OLDER_AGE = timedelta(days=14)  # only to reach the daily minimum, when the last 7 days don't have enough

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
PLACE_ALIASES = {"United Kingdom": ["uk", "great britain", "england"],
                 "United States": ["usa", "u.s.", "us only", "united states"], "United Arab Emirates": ["uae", "dubai"],
                 "Nigeria": ["lagos", "abuja", "ikeja", "lekki", "port harcourt", "ibadan", "kano", "enugu"]}
ANYWHERE = ["worldwide", "anywhere", "global", "remote (any", "all countries"]

TOO_SENIOR = {"entry": ["senior", "sr.", "sr ", "staff ", "lead ", "head of", "director", "principal", "manager", "chief", "vp ",
                        "vice president"],
              "mid": ["head of", "director", "chief", "vp ", "vice president", "principal"]}
# Jobs for speakers of another language ("AI Trainer - Bosnian", "CX Associate - German"). Nigerian languages and
# English stay in. Kept only when the person's own titles name that language.
LANGUAGES = re.compile(r"\b(albanian|arabic|armenian|bengali|bosnian|bulgarian|cantonese|catalan|chinese|croatian|czech|danish"
                       r"|dutch|estonian|farsi|finnish|flemish|french|georgian|german|greek|gujarati|hebrew|hindi|hungarian"
                       r"|icelandic|indonesian|italian|japanese|kazakh|korean|latvian|lithuanian|malay|mandarin|marathi"
                       r"|norwegian|persian|polish|portuguese|punjabi|romanian|russian|serbian|slovak|slovenian|spanish"
                       r"|swahili|swedish|tagalog|tamil|telugu|thai|turkish|ukrainian|urdu|uzbek|vietnamese)\b")
NON_LATIN = re.compile(r"[\u0400-\u04ff\u0590-\u06ff\u0900-\u097f\u0e00-\u0e7f\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]")
# Other roles (the last resort for the daily minimum) are never senior, whatever level the person chose.
OTHER_ROLE_SENIOR = re.compile(r"\b(senior|sr\.?|staff|lead|principal|head of|director|chief|vp|vice president)\b")
ENTRY_SIGNS = ["entry", "junior", "graduate", "trainee", "no experience", "intern"]
UNPAID = ["volunteer", "unpaid", "commission only", "commission-only", "equity only"]
SCAM_SIGNS = ["registration fee", "training fee", "pay a fee", "processing fee", "starter kit", "telegram",
              "whatsapp", "google hangouts", "wire transfer", "send money", "western union", "no interview",
              "unlimited earning"]
REMOTE_WORDS = ["remote", "work from home", "home based", "home-based", "anywhere"]
# Boards that make people create an account (or upgrade) before they can apply (checked 15 Oct 2026).
# They're no longer searched (the owner's call, 15 Oct 2026): people only get jobs they can apply to
# directly. If they're ever switched back on, their jobs only fill gaps and are tagged "sign-up needed".
SIGNUP_BOARDS = {"We Work Remotely", "Himalayas", "Jobicy", "RemoteOK"}
# The owner's call (15 Oct 2026): open remote VA and support jobs for Nigeria are rare, so for these titles only,
# sign-up boards fill the gap after open jobs, tagged "sign-up needed to apply".
SIGNUP_ROLES = re.compile(r"assistant|support|customer|admin|receptionist|data entry|help ?desk|call cent", re.I)
# Specialist tech titles: never used as an "other role" for someone who isn't looking for tech work.
TECH_TITLE = re.compile(r"engineer|developer|devops|\bsre\b|programmer|architect|data scien|machine learning|python|java|node\.?js|full.?stack|backend|frontend", re.I)
SIGNUP_PENALTY = 100
DEFAULT_COUNTRY = "Nigeria"  # for "Any country" accounts (search.score)


def _clean(html_text: str) -> str:
    """HTML -> plain text that keeps its paragraph breaks and bullet points (shown on the job page)."""
    t = re.sub(r"<\s*(?:br|/p|/li|/h\d|/div|/ul|/ol|/tr)\b[^>]*>", "\n", html_text or "", flags=re.I)
    t = re.sub(r"<\s*li\b[^>]*>", "\n• ", t, flags=re.I)
    t = unescape(re.sub(r"<[^>]+>", " ", t))
    t = re.sub(r"[^\S\n]+", " ", t)
    return re.sub(r"\s*\n\s*", "\n", t).strip()


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
def from_himalayas(keyword: str, country: str, employment: str = "") -> tuple:
    """employment: Himalayas' employment_type filter, e.g. "Part Time,Contractor" for part-time searches."""
    out = []
    try:
        params = {"q": keyword, "sort": "recent"}
        if employment:
            params["employment_type"] = employment
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


@lru_cache(maxsize=1)
def from_jobicy_latest() -> tuple:
    """Jobicy's newest jobs open anywhere or in EMEA, whatever the title: its tag search finds nothing for most
    titles (VA, support, data entry), so these are matched by title like the other feeds."""
    out, urls = [], set()
    for geo in ("anywhere", "emea"):
        for j in from_jobicy_geo(geo):
            if j["url"] not in urls:
                urls.add(j["url"])
                out.append(j)
    return tuple(out)


def from_jobicy_geo(geo: str) -> tuple:
    out = []
    try:
        for j in _get("https://jobicy.com/api/v2/remote-jobs", count=100, geo=geo).get("jobs", []):
            out.append(_raw(
                unescape(j.get("jobTitle", "")), j.get("companyName"), j.get("jobGeo") or "Anywhere", j.get("url"),
                "Jobicy", datetime.fromisoformat(j["pubDate"]) if j.get("pubDate") else None,
                _clean(j.get("jobExcerpt") or j.get("jobDescription")), True, j.get("jobLevel"),
                _pay(j.get("salaryMin"), j.get("salaryMax"), j.get("salaryCurrency"), j.get("salaryPeriod")),
                str(j.get("jobType") or ""),
                _monthly(j.get("salaryMin"), j.get("salaryMax"), j.get("salaryCurrency"), j.get("salaryPeriod"))))
        time.sleep(1)
    except Exception as e:
        print(f"[Jobicy:{geo}] skipped: {e}")
    return tuple(out)


# Whole-feed sources: fetched once per run and matched against every subscriber's job titles.

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
            title, company, where, desc = (item.findtext("title") or "").strip(), "", location, item.findtext("description")
            for el in item:  # namespaced extras some boards add, e.g. <job_listing:company>
                tag = el.tag.rsplit("}", 1)[-1].lower()
                if tag in ("company", "company_name", "companyname") and el.text:
                    company = el.text.strip()
                elif tag in ("location", "region") and el.text:
                    where = el.text.strip()
                elif tag == "creator" and el.text and "⚲" in el.text:  # Jobspresso: "Company<br>⚲&nbsp;United States"
                    company, _, place = el.text.partition("⚲")
                    company, where = _clean(company), _clean(place)
                elif tag == "encoded" and el.text:  # the whole advert, where "must be based in..." usually is
                    desc = el.text
            if not company and " at " in title:
                title, _, company = title.rpartition(" at ")
            posted = item.findtext("pubDate")
            out.append(_raw(title, company, where, item.findtext("link"), source,
                            parsedate_to_datetime(posted) if posted else None, _clean(desc), True))
    except Exception as e:
        print(f"[{source}] skipped: {e}")
    return tuple(out)


@lru_cache(maxsize=1)
def from_jobspresso() -> tuple:
    return _rss("https://jobspresso.co/feed/?post_type=job_listing", "Jobspresso")


# Companies that hire remotely and post every opening on a public careers page (Greenhouse, Lever or
# Ashby). Applying there needs no job-board account, and the advert comes straight from the employer.
CAREER_PAGES = {  # companies with remote jobs; the usual checks still drop ones not open to the user's country
    "greenhouse": ["canonical", "gitlab", "moniepoint", "okx", "bybit", "consensys", "wikimedia", "remotasks", "turing",
                   "mozilla", "grafanalabs", "coinbase", "webflow", "alxafrica", "bitwarden", "sproutsocial", "later",
                   "typeform", "brex", "cloudflare", "customerio", "elastic", "coursera", "invisibletech", "netlify",
                   "sourcegraph91"],
    "lever": ["jobgether", "binance", "appen", "toptal", "rws", "tala", "kinsta", "superside"],
    "ashby": ["supabase", "oyster", "posthog", "zapier", "notion", "1password", "hostinger", "clickup", "andela",
              "substack", "helpscout", "surfshark", "lemonade", "kit", "gorgias", "ledger", "airwallex", "close",
              "buffer", "miro", "contra"],
    "workable": ["remofirst", "kuda", "humanmade"],
    "recruitee": ["mailerlite"],
}


# Companies hiring on-site in Nigeria (checked 15 Oct 2026). Only searched for people who chose on-site;
# the usual country and city checks still apply.
LOCAL_PAGES = {
    "greenhouse": ["moniepoint", "jumia", "alxafrica"],
    "workable": ["fairmoney", "kuda", "renmoney"],
    "smartrecruiters": ["leadwaypensure", "giglogistics", "palmpay"],
    "breezy": ["busha", "oando", "prospa", "gokada"],
}
DESC_MAX = 8000  # the job page shows at most this much (db.DESCRIPTION_MAX)
CAREER_PAGES_FILE = os.path.join(os.path.dirname(__file__), "career_pages.json")


def career_pages() -> dict[str, list[str]]:
    """CAREER_PAGES plus the boards in career_pages.json (found from Hacker News hiring threads and checked)."""
    pages = {ats: list(slugs) for ats, slugs in CAREER_PAGES.items()}
    try:
        with open(CAREER_PAGES_FILE) as f:
            for ats, slugs in json.load(f).items():
                pages.setdefault(ats, [])
                pages[ats] += [s for s in slugs if s not in pages[ats]]
    except FileNotFoundError:
        pass
    return pages


def _career_page(ats: str, slug: str) -> list[dict]:
    """One company's open jobs as (title, company, location, url, posted, description, remote) dicts."""
    if ats == "greenhouse":
        data = _get(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs", content="true")
        name = slug
        return [dict(title=j.get("title"), company=(j.get("company_name") or name), location=(j.get("location") or {}).get("name", ""),
                     url=j.get("absolute_url"), posted=datetime.fromisoformat(j["first_published"]) if j.get("first_published") else None,
                     desc=_clean(unescape(j.get("content") or "")), remote=None) for j in data.get("jobs", [])]
    if ats == "lever":
        data = _get(f"https://api.lever.co/v0/postings/{slug}", mode="json")
        return [dict(title=j.get("text"), company=slug, location=(j.get("categories") or {}).get("location", ""),
                     url=j.get("hostedUrl"), posted=datetime.fromtimestamp(j["createdAt"] / 1000, timezone.utc) if j.get("createdAt") else None,
                     desc=_clean(j.get("descriptionPlain") or j.get("description") or ""),
                     remote=(j.get("workplaceType") == "remote") or None) for j in data if isinstance(j, dict)]
    if ats == "workable":
        data = _get(f"https://apply.workable.com/api/v1/widget/accounts/{slug}", details="true")
        return [dict(title=j.get("title"), company=data.get("name") or slug,
                     location=", ".join(x for x in (j.get("city"), j.get("country")) if x),
                     url=j.get("url") or j.get("shortlink"),
                     posted=datetime.fromisoformat(j["published_on"]).replace(tzinfo=timezone.utc) if j.get("published_on") else None,
                     desc=_clean(j.get("description") or ""), remote=j.get("telecommuting") or None) for j in data.get("jobs", [])]
    if ats == "breezy":  # the list has no description; the job page links to the full advert
        data = _get(f"https://{slug}.breezy.hr/json")
        return [dict(title=j.get("name"), company=(j.get("company") or {}).get("name") or slug,
                     location=(j.get("location") or {}).get("name", ""), url=j.get("url"),
                     posted=datetime.fromisoformat(j["published_date"].replace("Z", "+00:00")) if j.get("published_date") else None,
                     desc="", remote=(j.get("location") or {}).get("is_remote") or None) for j in data]
    if ats == "smartrecruiters":
        data = _get(f"https://api.smartrecruiters.com/v1/companies/{slug}/postings", limit=100)
        return [dict(title=j.get("name"), company=(j.get("company") or {}).get("name") or slug,
                     location=", ".join(x for x in ((j.get("location") or {}).get("city"),
                                                    (j.get("location") or {}).get("country", "").upper()) if x),
                     url=f"https://jobs.smartrecruiters.com/{slug}/{j.get('id')}",
                     posted=datetime.fromisoformat(j["releasedDate"].replace("Z", "+00:00")) if j.get("releasedDate") else None,
                     desc="", remote=(j.get("location") or {}).get("remote") or None) for j in data.get("content", [])]
    if ats == "recruitee":
        data = _get(f"https://{slug}.recruitee.com/api/offers/")
        return [dict(title=j.get("title"), company=j.get("company_name") or slug, location=j.get("location", ""),
                     url=j.get("careers_url"),
                     posted=datetime.fromisoformat(j["published_at"].replace(" UTC", "+00:00").replace(" ", "T"))
                     if j.get("published_at") else None,
                     desc=_clean(j.get("description") or ""), remote=j.get("remote") or None) for j in data.get("offers", [])]
    data = _get(f"https://api.ashbyhq.com/posting-api/job-board/{slug}", includeCompensation="true")
    return [dict(title=j.get("title"), company=slug, location=j.get("location", ""), url=j.get("jobUrl") or j.get("applyUrl"),
                 posted=datetime.fromisoformat(j["publishedAt"].replace("Z", "+00:00")) if j.get("publishedAt") else None,
                 desc=_clean(j.get("descriptionPlain") or j.get("descriptionHtml") or ""),
                 remote=j.get("isRemote") or None, pay=(j.get("compensation") or {}).get("compensationTierSummary") or "")
            for j in data.get("jobs", []) if j.get("isListed", True)]


@lru_cache(maxsize=1)
def from_career_pages() -> tuple:
    pages = [(ats, slug) for ats, slugs in career_pages().items() for slug in slugs]
    def fetch(page):
        ats, slug = page
        try:
            jobs = []
            for j in _career_page(ats, slug):
                loc = j["location"] or ""
                remote = j["remote"] if j["remote"] is not None else any(w in loc.lower() for w in REMOTE_WORDS)
                if not remote:
                    continue  # this source is for remote jobs; on-site ones come from Adzuna/Reed
                company = j["company"] if j["company"] != slug else slug.replace("-", " ").split(".")[0].title()
                jobs.append(_raw(j["title"], company, loc or "Remote", j["url"], "Company careers page",
                                 j["posted"], (j["desc"] or "")[:DESC_MAX], True, pay=j.get("pay", "")))
            return jobs
        except Exception as e:
            print(f"[Careers {ats}:{slug}] skipped: {str(e)[:80]}")
            return []
    with ThreadPoolExecutor(max_workers=24) as pool:
        found = list(pool.map(fetch, pages))
    out = [j for jobs in found for j in jobs]
    print(f"[Careers] {len(out)} remote jobs from {sum(1 for jobs in found if jobs)} of {len(pages)} companies")
    return tuple(out)


@lru_cache(maxsize=1)
def _local_pages_live() -> tuple:
    """On-site jobs from LOCAL_PAGES (for people who chose on-site, not remote)."""
    out = []
    for ats, slugs in LOCAL_PAGES.items():
        for slug in slugs:
            try:
                for j in _career_page(ats, slug):
                    if j["remote"]:
                        continue  # remote ones come from from_career_pages
                    company = j["company"] if j["company"] != slug else slug.title()
                    out.append(_raw(j["title"], company, j["location"], j["url"], "Company careers page",
                                    j["posted"], (j["desc"] or "")[:DESC_MAX], False, pay=j.get("pay", "")))
            except Exception as e:
                print(f"[Local {ats}:{slug}] skipped: {str(e)[:80]}")
    print(f"[Local] {len(out)} on-site jobs from {sum(map(len, LOCAL_PAGES.values()))} companies")
    return tuple(out)


def _remote_feeds_live() -> tuple:
    # Career pages go first, so when the same job is on a board too, the employer's own link is kept.
    return (from_career_pages() + from_workingnomads() + from_weworkremotely() + from_remoteok()
            + from_arbeitnow() + from_themuse() + from_jobspresso())


# Reading every board takes about 2 minutes, so each read is saved to JOB_POOL_FILE (the workflows keep it in
# the GitHub Actions cache). A new subscriber's first search (JOB_POOL_REUSE=1) reuses the latest saved read
# (the morning run's, or a later Telegram run's) instead of reading everything again; only a list older than
# JOB_POOL_MAX_HOURS (a missed morning run) is read again. Each job's age is still checked when it is matched.
POOL_MAX_AGE = timedelta(hours=float(os.environ.get("JOB_POOL_MAX_HOURS") or 26))


@lru_cache(maxsize=1)
def _pool() -> tuple[tuple, tuple]:
    """(remote jobs, on-site jobs from LOCAL_PAGES): reused from JOB_POOL_FILE when allowed and fresh, else read now."""
    path = os.environ.get("JOB_POOL_FILE", "")
    if path and os.environ.get("JOB_POOL_REUSE") == "1" and os.path.exists(path):
        try:
            with gzip.open(path, "rb") as f:
                saved = pickle.load(f)
            age = datetime.now(timezone.utc) - saved["at"]
            if age < POOL_MAX_AGE:
                print(f"[Pool] reusing {len(saved['remote'])} remote jobs read {int(age.total_seconds() // 60)} min ago")
                return saved["remote"], saved["local"]
            print(f"[Pool] saved list is {age} old, reading again")
        except Exception as e:
            print(f"[Pool] couldn't reuse the saved list: {e}")
    remote, local = _remote_feeds_live(), _local_pages_live()
    if path:
        try:
            with gzip.open(path, "wb") as f:
                pickle.dump({"at": datetime.now(timezone.utc), "remote": remote, "local": local}, f)
            print(f"[Pool] saved {len(remote)} remote jobs to {path} ({os.path.getsize(path) // 1024} KB)")
        except Exception as e:
            print(f"[Pool] couldn't save the list: {e}")
    return remote, local


def remote_feeds() -> tuple:
    return _pool()[0]


def from_local_pages() -> tuple:
    """On-site jobs from LOCAL_PAGES (for people who chose on-site, not remote)."""
    return _pool()[1]


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
    ["machine learning engineer", "ml engineer", "ai engineer", "ai/ml engineer", "llm engineer", "applied ai engineer"],
    ["prompt engineer", "prompt writer", "ai prompt engineer", "prompt engineering"],
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
    "prompt engineer": ["content writer", "data annotation", "ai automation"],
    "machine learning engineer": ["software engineer", "data analyst", "ai automation"],
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
    # "Anywhere in France" means France, and "South Africa" isn't the "Africa" region.
    loc = re.sub(r"anywhere in (?!the world)", "in ", loc)
    if not loc or any(w in loc for w in ANYWHERE):
        return True
    names = [country.lower()] + PLACE_ALIASES.get(country, [])
    if any(n in loc for n in names):
        return True
    # Remote jobs open to a region the person lives in ("EMEA", "Africa"...)
    region = loc.replace("south africa", "southafrica")
    return remote and any(re.search(rf"\b{re.escape(r)}\b", region) for r in COUNTRIES.get(country, ("", "", []))[2])


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
    r"\bopen to (?:candidates|applicants|residents|people|talent|those) (?:who are )?(?:in|from|based in|based within|located in|living in|residing in) {p}\b",
    r"\b(?:hiring|recruiting|available|open) (?:only )?(?:in|within) {p}(?: only)?\b",
    r"\bremote (?:role|position|job|opportunity)?\s?(?:in|within|across) {p}(?: only)?\b",
    r"\banywhere (?:in|within) {p}\b",
    r"\bhiring only (?:in|within|from) {p}\b",
    r"\b(?:candidates|applicants|someone|people|talent|professionals?|assistants?|representatives?|specialists?|agents?)\s*,?\s*"
    r"(?:who are |who is |must be |should be )?(?:based|located|living|residing) (?:in|within) {p}\b",
    r"\bbased (?:in|within) {p} only\b",
]
_LIMIT_RES = [(re.compile(t.replace("{p}\\b", "{p}(?![a-z])").format(p=f"(?:{place})")), allowed)
              for place, allowed in _PLACES.items() for t in _LIMITS]
# North American working hours named in the title ("Support Specialist, Pacific/Mountain Time", "... (EST)").
_US_HOURS = re.compile(r"\b(?:pacific|mountain|eastern|central)(?:\s*time\b|\s*/)|\b(?:pst|pdt|est|edt|cst|cdt|mst|mdt)\b")
_CITIZENS = re.compile(r"\b(?:us|u\.s\.) citizen(?:s|ship)?\b|\bsecurity clearance\b|\bw-2\b")


def open_to(job: dict, country: str) -> bool:
    """False when the advert says it only hires from places that don't include `country`."""
    if not country or not job["remote"]:
        return True
    text = f"{job['title']} {job['location']} {job['desc']}".lower()
    if country != "United States" and _CITIZENS.search(text):
        return False
    if country not in ("United States", "Canada") and _US_HOURS.search(job["title"].lower()):
        return False
    return all(country in allowed for rx, allowed in _LIMIT_RES if rx.search(text))


def says_open_to(job: dict, country: str) -> bool:
    """True when the listing explicitly names the country, one of its regions, or worldwide."""
    loc = job["location"].lower()
    names = [country.lower()] + PLACE_ALIASES.get(country, []) + COUNTRIES.get(country, ("", "", []))[2]
    return any(n in loc for n in names) or any(w in loc for w in ANYWHERE)


PART_TIME = re.compile(r"\bpart[\s_-]?time\b")


def is_part_time(job: dict) -> bool:
    """The board marks it part-time, or the title or advert says so."""
    return bool(PART_TIME.search(f"{job['job_type']} {job['title']} {job['desc'][:1500]}".lower()))


# Work that suits someone after part-time hours, even when the advert doesn't say "part-time".
FLEXIBLE = re.compile(r"\bfreelanc|\bflexible (?:hours|schedule|working hours)|\bset your own (?:hours|schedule)|\bhourly\b"
                      r"|\bper hour\b|\bproject[\s-]based\b|\b(?:[5-9]|[12]\d|30)\s*(?:-\s*\d+\s*)?(?:hours?|hrs?)\s*(?:per|a|/)\s*week\b")


def fits_part_time(job: dict) -> bool:
    """For people who asked for part-time: part-time, freelance, hourly or flexible-hours work."""
    if is_part_time(job):
        return True
    # A board or title that says full-time wins over "flexible hours" in the advert.
    if re.search(r"\bfull[\s_-]?time\b", f"{job['job_type']} {job['title']}".lower()):
        return False
    return bool(FLEXIBLE.search(f"{job['job_type']} {job['title']} {job['desc'][:1500]}".lower()))


def score(job: dict, keywords: list[str], country: str, remote_only: bool, level: str,
          city: str = "", why: Counter | None = None, hours: str = "any", max_age: timedelta = MAX_AGE,
          any_title: bool = False) -> tuple[int, list[str]] | None:
    """Returns (score, reasons), or None if the job fails a check (counted in `why` by reason).
    any_title: the last resort for the daily minimum: every other check still applies."""
    def no(reason):
        if why is not None:
            why[reason] += 1
        return None

    # Owner's rule (19 Oct 2026): most members are in Nigeria, so "Any country" accounts only get jobs open to Nigerians.
    country = country or DEFAULT_COUNTRY
    title, text = job["title"].lower(), f"{job['title']} {job['desc']}".lower()
    hit = "" if any_title else title_hit(title, keywords)
    if not hit and not any_title:
        return no("title doesn't match")
    if not job["url"] or not job["posted"]:
        return no("no link or date")
    if datetime.now(timezone.utc) - job["posted"] > max_age:
        return no("too old")
    if remote_only and not job["remote"]:
        return no("not remote")
    if not location_fits(job["location"], country, job["remote"]) or not open_to(job, country):
        return no("not open to their country")
    # A word that's part of the title they asked for ("manager" in "product manager") doesn't make a job too senior.
    senior = [w for w in TOO_SENIOR.get(level, []) if w.strip(" .") not in hit]
    if level in TOO_SENIOR and (any(w in f" {title} " for w in senior)
                                or job["level"].lower() in ("senior", "director", "executive")
                                or (job["level"].lower() == "manager" and "manager" not in hit)):
        return no("too senior")
    lang = LANGUAGES.search(title)
    if (lang and not any(lang.group(1) in k.lower() for k in keywords)) or NON_LATIN.search(job["title"]):
        return no("needs another language")
    if any_title and OTHER_ROLE_SENIOR.search(title):
        return no("too senior")
    if hours == "part" and not fits_part_time(job):
        return no("not part-time")
    if hours == "full" and is_part_time(job):
        return no("part-time")
    if any(w in f"{title} {job['job_type']}".lower() for w in UNPAID) or any(w in text for w in SCAM_SIGNS):
        return no("unpaid or scam signs")

    pts, reasons = 10, [f"matches \"{hit}\"" if hit else "other role", f"{'remote, ' if job['remote'] else ''}{job['location'] or 'location not stated'}"]
    if country and job["remote"] and says_open_to(job, country):
        pts += 1
        reasons.insert(0, f"open to {country}")
    if level == "entry" and ("entry" in job["level"].lower() or any(w in text for w in ENTRY_SIGNS)):
        pts += 3
        reasons.append("entry-level")
    if is_part_time(job):
        reasons.append("part-time")
    elif hours == "part" and fits_part_time(job):
        reasons.append("flexible hours")
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
    if job["source"] in SIGNUP_BOARDS:
        pts -= SIGNUP_PENALTY
        reasons.append("sign-up needed to apply")
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


# Jobs already sent to someone in the last 14 days (db.recent_jobs, loaded by send_daily). Adverts drop out of
# the live feeds after a few days but are often still open, so a new user whose titles are quiet today can
# still get them. They pass every check like any other listing (age, country, level, hours, never sent twice).
BACKLOG: list[dict] = []


def set_backlog(rows: list[dict]) -> None:
    BACKLOG[:] = [{**_raw(r["title"], r["company"], r["location"], r["url"], r["source"] or "Earlier matches",
                          r["posted_at"], r["description"], "remote" in (r["matched"] or "").lower(), pay=r["pay"] or ""),
                   "backlog": True} for r in rows if r.get("title")
                  # Jobspresso jobs sent before 20 Oct 2026 were all saved as "Anywhere" (its feed's real location
                  # wasn't read), so they can't be trusted; its live feed still brings the current ones.
                  and r.get("source") != "Jobspresso"]


def _search(keywords: list[str], country: str, remote_only: bool, level: str, city: str,
            seen: set[str], why: Counter, hours: str = "any", max_age: timedelta = MAX_AGE,
            any_title: bool = False) -> tuple[list[dict], Counter]:
    """Every listing that passes the checks for these titles, best first, plus how many listings each board gave.
    any_title (keywords empty): every open job, whatever the title, from the feeds already read."""
    pool = list(remote_feeds()) + ([] if remote_only else list(from_local_pages()))
    # Sign-up boards' jobs only count for VA and support titles (SIGNUP_ROLES), and for every part-time search
    # (owner's call, 19 Oct 2026: a part-time job behind a sign-up beats a full-time one).
    pool = [j for j in pool if j["source"] not in SIGNUP_BOARDS or hours == "part" or any(SIGNUP_ROLES.search(k) for k in keywords)]
    if any(SIGNUP_ROLES.search(k) for k in keywords):
        pool += from_jobicy_latest()
    for k in keywords:
        pool += from_jooble(k, "" if remote_only else (city or country))
        if SIGNUP_ROLES.search(k):
            pool += from_himalayas(k, country) + from_jobicy(k)
        if hours == "part":  # Himalayas can be asked for part-time and contract work only
            pool += from_himalayas(k, country, "Part Time,Contractor")
        if not remote_only:
            pool += from_adzuna(k, country, city) + (from_reed(k, city) if country == "United Kingdom" else ())
    pool += BACKLOG  # after the live listings, so a job still in today's feeds keeps its fresh copy
    pool.sort(key=lambda j: j["source"] in SIGNUP_BOARDS)  # duplicates keep the open board's link (stable sort)
    ranked = []
    for job in pool:
        keys = job_keys(job)
        if keys & seen:
            why["already sent or duplicate"] += 1
            continue
        result = score(job, keywords, country, remote_only, level, city, why, hours, max_age, any_title)
        if result:
            seen |= keys
            matched = list(result[1])
            if country == "Nigeria" and job["pay"] and (naira := in_naira(job.get("pay_month"))):
                matched = [f"{m} ({naira})" if m == job["pay"] else m for m in matched]
            ranked.append({**job, "score": result[0], "matched": matched,
                           "hit": "other role" if any_title else title_hit(job["title"], keywords)})
    ranked.sort(key=lambda j: j["score"], reverse=True)
    return ranked, Counter("Earlier matches" if j.get("backlog") else j["source"].split(" (")[0] for j in pool)


def _copy_of(job: dict, others: list[dict]) -> bool:
    """The same advert under another title: one company posting it once per county or city
    ("Gloucestershire Customer Support Agent", "Oxfordshire Customer Support Agent", ...)."""
    co, words = _words(job["company"]), set(_words(job["title"]).split())
    for o in others:
        if co and _words(o["company"]) == co:
            theirs = set(_words(o["title"]).split())
            if len(words & theirs) >= 0.6 * max(len(words), len(theirs), 1):
                return True
    return False


def _pick(ranked: list[dict], keywords: list[str], n: int) -> list[dict]:
    """Up to n working jobs, taking turns between the titles so one busy title doesn't fill every email."""
    picked, used = [], {k: 0 for k in keywords}
    while len(picked) < n and ranked:
        fewest = min(used[j["hit"]] for j in ranked)
        job = next(j for j in ranked if used[j["hit"]] == fewest)
        ranked.remove(job)
        if not _copy_of(job, picked) and _link_ok(job["url"]):
            picked.append(job)
            used[job["hit"]] += 1
    return picked


SPARES = 15  # next-best jobs kept for members' "More jobs" button (3 taps of 5)


def find_jobs(keywords_csv: str, country: str, remote_only: bool, level: str, exclude: set[str], n: int = 5,
              city: str = "", minimum: int = 0, hours: str = "any", cv: str | None = None,
              spares: list | None = None) -> list[dict]:
    """remote_only=True searches remote jobs. False means on-site/hybrid near `city` (via Adzuna/Reed),
    with remote jobs as a fallback.

    Up to `n` jobs for their own titles. If that's fewer than `minimum`, the gap is filled from the
    next-closest roles (NEIGHBOURS, then the broad entry-level titles), marked "similar role". Every job
    still passes every check: last 7 days, open to their country, seniority, scam signs, never sent before.

    cv: members only (None for everyone else). Claude then reorders the open jobs by how well they fit
    the CV (or titles and level when it's empty) and adds the reason (ai_match).

    spares: a list to fill with up to SPARES next-best working jobs (own titles first, then any similar roles
    found), for "More jobs" on the members' dashboard."""
    keywords = clean_keywords(keywords_csv)[:5]
    seen, why = sent_keys(exclude), Counter()
    ranked, boards = _search(keywords, country, remote_only, level, city, seen, why, hours)
    matched = len(ranked)
    signup = lambda j: j["source"] in SIGNUP_BOARDS
    tech = any(TECH_TITLE.search(k) for k in keywords)  # only people looking for tech jobs get other tech roles
    # Jobs people can apply to without signing up come first: their own titles, then similar roles.
    open_jobs = [j for j in ranked if not signup(j)]
    if cv is not None:
        open_jobs = ai_match.rerank(open_jobs, keywords, level, country, cv)
    picked = _pick(open_jobs, keywords, n)
    more, near = [], neighbours(keywords)
    if len(picked) < minimum and near:
        more, _ = _search(near, country, remote_only, level, city, seen, Counter(), hours)
        for j in more:
            j["matched"] = ["similar role"] + j["matched"]
        more.sort(key=lambda j: (near.index(j["hit"]), -j["score"]))  # closest roles first
    def fill(pool: list[dict]) -> int:
        added = 0
        for j in pool:
            if len(picked) >= minimum:
                break
            if not _copy_of(j, picked) and _link_ok(j["url"]):
                picked.append(j)
                added += 1
        return added
    # VA and support titles (SIGNUP_ROLES), and every part-time search: their own title from a sign-up board
    # beats a similar role, tagged "sign-up needed to apply".
    gated_ok = lambda j: signup(j) and (hours == "part" or SIGNUP_ROLES.search(j["hit"]) and any(SIGNUP_ROLES.search(k) for k in keywords))
    gated = fill([j for j in ranked if gated_ok(j)])
    extra = fill([j for j in more if not signup(j)])
    gated += fill([j for j in more if gated_ok(j)])
    # Part-time and still short: part-time jobs one step further out (the similar roles of their similar roles),
    # then their own and similar titles' part-time jobs from the last 14 days, before any full-time job.
    far = []
    if hours == "part" and len(picked) < minimum:
        far = [t for t in neighbours(keywords + near) if t not in keywords + near]
        if far:
            pool, _ = _search(far, country, remote_only, level, city, seen, Counter(), hours)
            for j in pool:
                j["matched"] = ["similar role"] + j["matched"]
            extra += fill([j for j in pool if not signup(j)])
            gated += fill([j for j in pool if signup(j)])
    # Still short: nobody gets fewer than the minimum. First their own and similar titles posted in the last
    # 14 days, then the best other open roles at their level, open to their country.
    # Members' "More jobs" spares come from the same places when the first ones run short.
    older = other = 0
    older_pool, other_pool = [], []
    taken = {id(j) for j in picked}
    short = lambda: len(picked) < minimum or (spares is not None and
        sum(id(j) not in taken and not signup(j) for j in open_jobs + more + older_pool) < SPARES)
    if short():
        older_pool, _ = _search(keywords + near + far, country, remote_only, level, city, seen, Counter(), hours, max_age=OLDER_AGE)
        older_gated = [j for j in older_pool if signup(j) and hours == "part"]
        older_pool = [j for j in older_pool if not signup(j)]
        for j in older_pool + older_gated:
            if j["hit"] not in keywords:
                j["matched"] = ["similar role"] + j["matched"]
        older = fill(older_pool)
        gated += fill(older_gated)
        taken = {id(j) for j in picked}
    # Part-time and still short after every part-time job with a close title (owner's rule, 18 Oct 2026):
    # their own and similar titles at any hours, marked "full-time", come before other roles.
    relaxed = 0
    if hours == "part" and len(picked) < minimum:
        pool, _ = _search(keywords + near, country, remote_only, level, city, seen, Counter(), "any")
        for j in pool:
            j["matched"] = ["full-time"] + j["matched"]
        relaxed = fill([j for j in pool if not signup(j)]) + fill([j for j in pool if gated_ok(j)])
        taken = {id(j) for j in picked}
    if short():
        other_pool, _ = _search([], country, remote_only, level, city, seen, Counter(), hours, any_title=True)
        other_pool = [j for j in other_pool if not signup(j) and (tech or not TECH_TITLE.search(j["title"]))][:ai_match.TOP * 2]
        if cv is not None:
            other_pool = ai_match.rerank(other_pool, keywords, level, country, cv)
        other = fill(other_pool)
    # Part-time only and still short: other roles at any hours, marked "full-time".
    if hours == "part" and len(picked) < minimum:
        pool, _ = _search([], country, remote_only, level, city, seen, Counter(), "any", any_title=True)
        pool = [j for j in pool if not signup(j) and (tech or not TECH_TITLE.search(j["title"]))]
        for j in pool:
            j["matched"] = ["full-time"] + j["matched"]
        other += fill(pool)
    if spares is not None:
        taken = {id(j) for j in picked}
        rest = []
        for j in open_jobs + more + older_pool + other_pool:
            if id(j) not in taken and not signup(j) and not _copy_of(j, picked + rest):
                rest.append(j)
        rest = rest[:SPARES * 2]
        with ThreadPoolExecutor(max_workers=8) as pool:
            ok = list(pool.map(lambda j: _link_ok(j["url"]), rest))
        spares.extend([j for j, good in zip(rest, ok) if good][:SPARES])
    print(f"  checked {sum(boards.values())} listings ({', '.join(f'{s} {c}' for s, c in boards.most_common())}), "
          f"{matched} matched, picked {len(picked)}{f' ({extra} from similar roles to reach the daily minimum)' if extra else ''}"
          f"{f', {gated} from sign-up boards to fill the gap' if gated else ''}"
          f"{f', {relaxed} full-time for a part-time search' if relaxed else ''}"
          f"{f', {older} posted 8-14 days ago' if older else ''}{f', {other} from other roles' if other else ''}"
          f"{f', {len(spares)} spare for More jobs' if spares is not None else ''}; "
          f"left out: {', '.join(f'{c} {r}' for r, c in why.most_common()) or 'none'}")
    return picked


if __name__ == "__main__":
    # Preview without a database or email:  python -m job_alerts.search "virtual assistant, pr" Nigeria entry
    import sys
    kw, where, lvl = (sys.argv[1:] + ["", "", "any"])[:3]
    for j in find_jobs(kw or "virtual assistant", where, True, lvl or "any", set(), n=10, minimum=5):
        print(f"- {j['title']} | {j['company']} | {', '.join(j['matched'])} | {j['url']}")
