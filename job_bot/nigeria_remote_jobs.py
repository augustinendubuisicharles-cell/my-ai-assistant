"""Finds remote PR and PA (personal / virtual / executive assistant) jobs that
someone living in Nigeria can actually apply for, and checks each one.

Sources (no key needed): Himalayas (filters by country=Nigeria, which includes
worldwide roles), Jobicy (Anywhere / EMEA roles), Remotive (worldwide roles).

"Verified" here means every job sent has passed all of these checks:
  1. the listing is open to Nigeria (worldwide, Africa, EMEA or Nigeria),
  2. it was posted in the last 21 days,
  3. it's not a senior/manager/director role (so it's realistic to land),
  4. it shows none of the usual scam signs (fees, Telegram/WhatsApp interviews...),
  5. its link still loads and doesn't say the job has closed.
"""
import re
import time
from datetime import datetime, timedelta, timezone
from html import unescape

import requests

TIMEOUT = 20
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; JobSearchBot/1.0; +personal use)"}
MAX_AGE = timedelta(days=21)

ROLES = {
    "PA / virtual assistant": [
        "virtual assistant", "personal assistant", "executive assistant", "administrative assistant",
        "admin assistant", "executive administrative", "administrative coordinator", "office assistant",
        "remote assistant", "calendar", "inbox manag",
    ],
    "PR & communications": [
        "public relations", "pr specialist", "pr coordinator", "pr assistant", "pr executive",
        "pr associate", "pr manager", "media relations", "publicist", "communications assistant",
        "communications coordinator", "communications specialist", "communications associate",
        "communications officer", "press officer", "comms",
    ],
}
# Titles that contain "assistant" etc. but are a different job.
WRONG_ROLE = ["assistant professor", "medical assistant", "dental assistant", "pharmacy assistant",
              "teaching assistant", "nursing assistant", "assistant controller", "physician assistant",
              "legal assistant", "engineer", "developer"]
TOO_SENIOR = ["senior", "sr.", "sr ", "head of", "director", "vp ", "vice president", "chief", "lead ", "principal"]
# Listings aimed at one other country even though they're tagged worldwide.
OTHER_COUNTRY_ONLY = ["philippine", "latam", "latin america", "us only", "usa only", "us-based", "u.s. only",
                      "canada only", "uk only", "eu only", "india only", "south africa only"]
OPEN_TO_NIGERIA = ["worldwide", "anywhere", "global", "africa", "emea", "nigeria", "lagos", "abuja"]
SCAM_SIGNS = ["registration fee", "training fee", "pay a fee", "processing fee", "starter kit", "telegram",
              "whatsapp", "google hangouts", "wire transfer", "send money", "western union", "crypto payment",
              "no interview", "earn $", "unlimited earning"]
CLOSED_SIGNS = ["no longer accepting", "job has expired", "position has been filled", "this job is closed",
                "no longer available", "job is no longer"]


def _clean(html_text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html_text or "")
    return re.sub(r"\s+", " ", unescape(text)).strip()


def _role(title: str) -> str | None:
    t = f" {title.lower()} "
    if any(w in t for w in WRONG_ROLE):
        return None
    for role, words in ROLES.items():
        if any(w in t for w in words) or re.search(r"\bpr\b" if role.startswith("PR") else r"\bva\b", t):
            return role
    return None


def _job(title, company, location, url, source, posted, desc, level="", pay="") -> dict | None:
    """Builds a job dict, or returns None when the listing fails checks 1-4."""
    role = _role(title)
    if not role or not url or not posted:
        return None
    text = f"{title} {desc}".lower()
    if any(w in f" {title.lower()} " for w in TOO_SENIOR) or level.lower() in ("senior", "manager", "director", "executive"):
        return None
    if any(w in text for w in OTHER_COUNTRY_ONLY) or any(w in text for w in SCAM_SIGNS):
        return None
    if not any(w in location.lower() for w in OPEN_TO_NIGERIA):
        return None
    if datetime.now(timezone.utc) - posted > MAX_AGE:
        return None

    score, reasons = 5, [role, f"open to: {location}"]
    if "entry" in level.lower() or "junior" in text or "no experience" in text:
        score += 3
        reasons.append("entry-level")
    if pay:
        score += 2
        reasons.append(pay)
    if any(w in text for w in ("part-time", "part time", "contract", "freelance", "flexible")):
        score += 1
        reasons.append("flexible/part-time")
    score += max(0, 3 - (datetime.now(timezone.utc) - posted).days // 5)  # fresher is better
    reasons.append(f"posted {posted:%d %b}")
    return {"title": title.strip(), "company": (company or "").strip(), "location": location,
            "url": url, "source": source, "score": score, "matched": reasons}


def _pay(lo, hi, currency, period) -> str:
    if not (lo or hi) or not currency:
        return ""
    rng = f"{lo:,.0f}-{hi:,.0f}" if lo and hi and lo != hi else f"{(lo or hi):,.0f}"
    return f"{currency} {rng}/{(period or '').replace('ly', '').replace('annual', 'year') or 'period'}"


def _from_himalayas() -> list[dict]:
    jobs = []
    for q in ["virtual assistant", "executive assistant", "personal assistant", "public relations", "communications"]:
        try:
            r = requests.get("https://himalayas.app/jobs/api/search",
                             params={"q": q, "country": "NG", "sort": "recent"}, headers=HEADERS, timeout=TIMEOUT)
            r.raise_for_status()
            for j in r.json().get("jobs", []):
                where = ", ".join(j.get("locationRestrictions") or []) or "Worldwide"
                job = _job(
                    j.get("title", ""), j.get("companyName"), where, j.get("applicationLink"), "Himalayas",
                    datetime.fromtimestamp(j["pubDate"], timezone.utc) if j.get("pubDate") else None,
                    _clean(j.get("description") or j.get("excerpt") or ""),
                    level=", ".join(j.get("seniority") or []),
                    pay=_pay(j.get("minSalary"), j.get("maxSalary"), j.get("currency"), j.get("salaryPeriod")),
                )
                if job:
                    jobs.append(job)
            time.sleep(1)
        except Exception as e:
            print(f"[Himalayas:{q}] skipped: {e}")
    return jobs


def _from_jobicy() -> list[dict]:
    jobs = []
    for geo in ["anywhere", "emea"]:
        for industry in ["admin-support", "marketing"]:
            try:
                r = requests.get("https://jobicy.com/api/v2/remote-jobs",
                                 params={"count": 100, "geo": geo, "industry": industry}, headers=HEADERS, timeout=TIMEOUT)
                r.raise_for_status()
                for j in r.json().get("jobs", []):
                    posted = j.get("pubDate")
                    job = _job(
                        unescape(j.get("jobTitle", "")), j.get("companyName"), j.get("jobGeo") or geo.title(),
                        j.get("url"), "Jobicy",
                        datetime.fromisoformat(posted) if posted else None,
                        _clean(j.get("jobExcerpt") or j.get("jobDescription") or ""),
                        level=j.get("jobLevel") or "",
                        pay=_pay(j.get("salaryMin"), j.get("salaryMax"), j.get("salaryCurrency"), j.get("salaryPeriod")),
                    )
                    if job:
                        jobs.append(job)
                time.sleep(1)
            except Exception as e:
                print(f"[Jobicy:{geo}/{industry}] skipped: {e}")
    return jobs


def _from_remotive() -> list[dict]:
    # Remotive asks for no more than a few calls a day; this runs once a week.
    jobs = []
    for q in ["assistant", "public relations"]:
        try:
            r = requests.get("https://remotive.com/api/remote-jobs", params={"search": q, "limit": 100},
                             headers=HEADERS, timeout=TIMEOUT)
            r.raise_for_status()
            for j in r.json().get("jobs", []):
                posted = j.get("publication_date")
                job = _job(
                    j.get("title", ""), j.get("company_name"), j.get("candidate_required_location") or "",
                    j.get("url"), "Remotive",
                    datetime.fromisoformat(posted).replace(tzinfo=timezone.utc) if posted else None,
                    _clean(j.get("description", "")),
                    pay=j.get("salary") or "",
                )
                if job:
                    jobs.append(job)
        except Exception as e:
            print(f"[Remotive:{q}] skipped: {e}")
    return jobs


def _link_is_live(url: str) -> bool:
    """Check 5: the listing still exists and doesn't say it's closed.

    Job boards often block automated visits (403/429) -- that isn't evidence the
    job is gone, so only a "not found"/"gone" answer or a "closed" notice fails it.
    """
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True)
    except Exception as e:
        print(f"[link check] FAIL {url}: {e}")
        return False
    if r.status_code in (404, 410):
        print(f"[link check] FAIL {url}: {r.status_code}")
        return False
    page = r.text[:300_000].lower() if r.ok else ""
    closed = next((w for w in CLOSED_SIGNS if w in page), None)
    print(f"[link check] {'FAIL' if closed else 'ok'} {url}: {r.status_code}{f' says {closed!r}' if closed else ''}")
    return not closed


def find_top_jobs(n: int = 5) -> list[dict]:
    all_jobs = _from_himalayas() + _from_jobicy() + _from_remotive()
    seen, unique = set(), []
    for j in all_jobs:
        key = (j["title"].lower(), j["company"].lower())
        if key not in seen:
            seen.add(key)
            unique.append(j)
    unique.sort(key=lambda j: j["score"], reverse=True)
    print(f"{len(unique)} listing(s) passed checks 1-4; checking links...")

    # Mix the two roles so one week isn't all PA or all PR, when both exist.
    verified, per_role = [], {}
    for j in unique:
        if len(verified) >= n:
            break
        role = j["matched"][0]
        if per_role.get(role, 0) >= n - 1 and any(o["matched"][0] != role for o in unique):
            continue
        if _link_is_live(j["url"]):
            verified.append(j)
            per_role[role] = per_role.get(role, 0) + 1
        time.sleep(1)
    return verified
