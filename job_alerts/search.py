"""Finds jobs for one subscriber's preferences and ranks them.

Remote jobs (no keys needed): Himalayas, Jobicy, Remotive.
On-site/hybrid jobs (optional keys): Adzuna (19 countries, free key at
developer.adzuna.com: ADZUNA_APP_ID + ADZUNA_APP_KEY) and Reed (UK, free key:
REED_API_KEY). Without those keys, on-site coverage is thin, so the form
encourages remote searches.

Every job sent has passed: location fits the subscriber, posted in the last
3 weeks, seniority fits, paid and no common scam signs, not past the board's
expiry date, and its link doesn't come back "not found".
"""
import os
import re
import time
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from html import unescape
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import requests

TIMEOUT = 20
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; JobAlertsBot/1.0)"}
MAX_AGE = timedelta(days=21)

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


def _raw(title, company, location, url, source, posted, desc, remote, level="", pay="", job_type="") -> dict:
    return {"title": (title or "").strip(), "company": (company or "").strip(), "location": location or "",
            "url": url or "", "source": source, "posted": posted, "desc": desc or "", "remote": remote,
            "level": level or "", "pay": pay or "", "job_type": job_type or ""}


def _pay(lo, hi, currency, period) -> str:
    if not (lo or hi) or not currency:
        return ""
    rng = f"{lo:,.0f}-{hi:,.0f}" if lo and hi and lo != hi else f"{(lo or hi):,.0f}"
    return f"{currency} {rng}/{(period or '').replace('ly', '').replace('annual', 'year') or 'period'}"


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
                j.get("employmentType")))
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
                str(j.get("jobType") or "")))
        time.sleep(1)
    except Exception as e:
        print(f"[Jobicy:{keyword}] skipped: {e}")
    return tuple(out)


@lru_cache(maxsize=None)
def from_remotive(keyword: str) -> tuple:
    out = []
    try:
        for j in _get("https://remotive.com/api/remote-jobs", search=keyword, limit=100).get("jobs", []):
            posted = j.get("publication_date")
            out.append(_raw(
                j.get("title"), j.get("company_name"), j.get("candidate_required_location"), j.get("url"), "Remotive",
                datetime.fromisoformat(posted).replace(tzinfo=timezone.utc) if posted else None,
                _clean(j.get("description")), True, pay=j.get("salary") or "", job_type=j.get("job_type") or ""))
    except Exception as e:
        print(f"[Remotive:{keyword}] skipped: {e}")
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
                  "max_days_old": 21, "sort_by": "date"}
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
                pay=f"GBP {j['minimumSalary']:,.0f}+" if j.get("minimumSalary") else ""))
    except Exception as e:
        print(f"[Reed:{keyword}] skipped: {e}")
    return tuple(out)


# --- matching ---

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
          city: str = "") -> tuple[int, list[str]] | None:
    """Returns (score, reasons), or None if the job fails a check."""
    title, text = job["title"].lower(), f"{job['title']} {job['desc']}".lower()
    hit = next((k for k in keywords if k in title), None)
    if not hit or not job["url"] or not job["posted"]:
        return None
    if datetime.now(timezone.utc) - job["posted"] > MAX_AGE:
        return None
    if remote_only and not job["remote"]:
        return None
    if not location_fits(job["location"], country, job["remote"]) or not open_to(job, country):
        return None
    if level in TOO_SENIOR and (any(w in f" {title} " for w in TOO_SENIOR[level])
                                or job["level"].lower() in ("senior", "manager", "director", "executive")):
        return None
    if any(w in f"{title} {job['job_type']}".lower() for w in UNPAID) or any(w in text for w in SCAM_SIGNS):
        return None

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
    pts += max(0, 3 - (datetime.now(timezone.utc) - job["posted"]).days // 5)
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


def find_jobs(keywords_csv: str, country: str, remote_only: bool, level: str, exclude: set[str], n: int = 5,
              city: str = "") -> list[dict]:
    """remote_only=True searches remote jobs. False means on-site/hybrid near `city` (via Adzuna/Reed),
    with remote jobs as a fallback."""
    keywords = [k.strip().lower() for k in keywords_csv.split(",") if k.strip()][:5]
    pool = []
    for k in keywords:
        pool += from_himalayas(k, country) + from_jobicy(k) + from_remotive(k)
        if not remote_only:
            pool += from_adzuna(k, country, city) + (from_reed(k, city) if country == "United Kingdom" else ())

    seen, ranked = sent_keys(exclude), []
    for job in pool:
        keys = job_keys(job)
        if keys & seen:
            continue
        result = score(job, keywords, country, remote_only, level, city)
        if result:
            seen |= keys
            hit = next(k for k in keywords if k in job["title"].lower())
            ranked.append({**job, "score": result[0], "matched": result[1], "hit": hit})
    ranked.sort(key=lambda j: j["score"], reverse=True)

    # Take turns between their keywords, so one busy job title doesn't fill every email.
    picked, used = [], {k: 0 for k in keywords}
    while len(picked) < n and ranked:
        fewest = min(used[j["hit"]] for j in ranked)
        job = next(j for j in ranked if used[j["hit"]] == fewest)
        ranked.remove(job)
        if _link_ok(job["url"]):
            picked.append(job)
            used[job["hit"]] += 1
    return picked


if __name__ == "__main__":
    # Preview without a database or email:  python -m job_alerts.search "virtual assistant, pr" Nigeria entry
    import sys
    kw, where, lvl = (sys.argv[1:] + ["", "", "any"])[:3]
    for j in find_jobs(kw or "virtual assistant", where, True, lvl or "any", set()):
        print(f"- {j['title']} | {j['company']} | {', '.join(j['matched'])} | {j['url']}")
