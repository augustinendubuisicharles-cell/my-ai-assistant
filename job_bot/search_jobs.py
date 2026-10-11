"""Searches free job boards for roles matching your profile and scores them.

Sources used (no key needed): Arbeitnow, RemoteOK, jobs.ac.uk (UK higher education).
Source used if REED_API_KEY is set (optional, free at reed.co.uk/developers):
Reed -- the only one of these with an explicit "part time only" filter, which
is the best direct match for a 20-hours-a-week cap.
"""
import re
import xml.etree.ElementTree as ET
from html import unescape

import requests

TIMEOUT = 20
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; JobSearchBot/1.0; +personal use)"}

# What to look for in a title/description, grouped so we can say *why* a job matched.
KEYWORDS = {
    "software engineering": [
        "software engineer", "backend", "full stack", "full-stack", "developer",
        "devops", "platform engineer", "site reliability", "python developer", "cloud engineer",
    ],
    "cloud & network security": [
        "cyber security", "cybersecurity", "network security", "cloud security",
        "information security", "security engineer", "soc analyst", "penetration test", "infosec",
    ],
    "higher education teaching": [
        "lecturer", "teaching fellow", "teaching associate", "associate lecturer",
        "research associate", "postdoctoral", "demonstrator", "graduate teaching assistant", "module leader",
    ],
}
REMOTE_WORDS = ["remote", "work from home", "home based", "home-based", "hybrid"]
PART_TIME_WORDS = ["part-time", "part time", "flexible hours", "hours a week", "hrs/week", "20 hours"]
FULL_TIME_FLAGS = ["full-time only", "35 hours a week", "37.5 hours", "40 hours a week", "on-site only", "no remote"]

MIN_SCORE = 4  # needs at least one keyword match plus a remote/part-time signal


def _clean(html_text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html_text or "")
    return re.sub(r"\s+", " ", unescape(text)).strip()


def _score(title: str, desc: str, already_remote: bool = False, already_part_time: bool = False) -> tuple[int, list[str]]:
    text = f"{title} {desc}".lower()
    score = 0
    matched = []
    if already_remote or any(w in text for w in REMOTE_WORDS):
        score += 3
    if already_part_time or any(w in text for w in PART_TIME_WORDS):
        score += 3
    for category, words in KEYWORDS.items():
        if any(w in text for w in words):
            score += 2
            matched.append(category)
    if any(w in text for w in FULL_TIME_FLAGS):
        score -= 4
    return score, matched


def _from_arbeitnow() -> list[dict]:
    try:
        resp = requests.get("https://arbeitnow.com/api/job-board-api", headers=HEADERS, timeout=TIMEOUT)
        resp.raise_for_status()
        jobs = []
        for j in resp.json().get("data", []):
            desc = _clean(j.get("description", ""))
            score, matched = _score(j.get("title", ""), desc, already_remote=bool(j.get("remote")))
            jobs.append({
                "title": j.get("title", "").strip(), "company": j.get("company_name", "").strip(),
                "location": j.get("location") or ("Remote" if j.get("remote") else ""),
                "url": j.get("url", ""), "source": "Arbeitnow", "score": score, "matched": matched,
            })
        return jobs
    except requests.RequestException as e:
        print(f"[Arbeitnow] skipped: {e}")
        return []


def _from_remoteok() -> list[dict]:
    try:
        resp = requests.get("https://remoteok.com/api", headers=HEADERS, timeout=TIMEOUT)
        resp.raise_for_status()
        jobs = []
        for j in resp.json():
            if "id" not in j or "position" not in j:
                continue  # first item is a legal notice, not a job
            desc = _clean(j.get("description", ""))
            title = j.get("position", "").strip()
            score, matched = _score(title, desc + " " + " ".join(j.get("tags", [])), already_remote=True)
            jobs.append({
                "title": title, "company": j.get("company", "").strip(),
                "location": j.get("location") or "Remote",
                "url": "https://remoteok.com" + j.get("url", "") if j.get("url", "").startswith("/") else j.get("url", ""),
                "source": "RemoteOK", "score": score, "matched": matched,
            })
        return jobs
    except (requests.RequestException, ValueError) as e:
        print(f"[RemoteOK] skipped: {e}")
        return []


def _from_jobs_ac_uk(queries: list[str]) -> list[dict]:
    jobs = []
    for q in queries:
        try:
            resp = requests.get(
                "https://www.jobs.ac.uk/search/", params={"keywords": q, "format": "rss"},
                headers=HEADERS, timeout=TIMEOUT,
            )
            resp.raise_for_status()
            root = ET.fromstring(resp.content)
            for item in root.findall(".//item"):
                title = (item.findtext("title") or "").strip()
                link = (item.findtext("link") or "").strip()
                desc = _clean(item.findtext("description") or "")
                if not title or not link:
                    continue
                score, matched = _score(title, desc)
                jobs.append({
                    "title": title, "company": "", "location": "UK (see listing)",
                    "url": link, "source": "jobs.ac.uk", "score": score, "matched": matched,
                })
        except (requests.RequestException, ET.ParseError) as e:
            print(f"[jobs.ac.uk:{q}] skipped: {e}")
    return jobs


def _from_reed(api_key: str) -> list[dict]:
    jobs = []
    queries = ["software engineer", "cloud security", "network security", "lecturer computer science"]
    for q in queries:
        try:
            resp = requests.get(
                "https://www.reed.co.uk/api/1.0/search",
                params={"keywords": q, "partTimeOnly": "true", "locationName": "UK"},
                auth=(api_key, ""), headers=HEADERS, timeout=TIMEOUT,
            )
            resp.raise_for_status()
            for j in resp.json().get("results", []):
                desc = _clean(j.get("jobDescription", ""))
                title = j.get("jobTitle", "").strip()
                score, matched = _score(title, desc, already_part_time=True)
                jobs.append({
                    "title": title, "company": j.get("employerName", "").strip(),
                    "location": j.get("locationName", ""),
                    "url": j.get("jobUrl", ""), "source": "Reed", "score": score, "matched": matched,
                })
        except requests.RequestException as e:
            print(f"[Reed:{q}] skipped: {e}")
    return jobs


def find_top_jobs(reed_api_key: str | None = None, n: int = 5) -> list[dict]:
    all_jobs = (
        _from_arbeitnow()
        + _from_remoteok()
        + _from_jobs_ac_uk(["teaching fellow computing", "cyber security lecturer", "part-time lecturer"])
    )
    if reed_api_key:
        all_jobs += _from_reed(reed_api_key)

    seen, unique = set(), []
    for j in all_jobs:
        key = (j["title"].lower().strip(), j["company"].lower().strip())
        if key in seen or j["score"] < MIN_SCORE:
            continue
        seen.add(key)
        unique.append(j)

    unique.sort(key=lambda j: j["score"], reverse=True)
    return unique[:n]
