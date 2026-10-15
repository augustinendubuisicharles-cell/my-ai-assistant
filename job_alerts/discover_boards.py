"""Keeps job_alerts/career_pages.json fresh (run monthly by job_alerts_refresh_boards.yml).

Re-checks every saved company job board, drops the ones that no longer exist, and adds new ones linked from
Hacker News "Who is hiring" posts and comments. Run:  python -m job_alerts.discover_boards
"""
import json
import re
from concurrent.futures import ThreadPoolExecutor
from html import unescape

import requests

from job_alerts.search import CAREER_PAGES, CAREER_PAGES_FILE

HEADERS = {"User-Agent": "Mozilla/5.0 JobAlert"}
PATTERNS = {"greenhouse": r"(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io/(?:embed/job_board\?for=)?([a-z0-9_-]+)",
            "lever": r"jobs\.lever\.co/([a-z0-9._-]+)", "ashby": r"jobs\.ashbyhq\.com/([a-z0-9._%-]+)",
            "workable": r"apply\.workable\.com/([a-z0-9_-]+)", "recruitee": r"([a-z0-9-]+)\.recruitee\.com"}
NOT_SLUGS = {"embed", "api", "v1", "jobs", "www", "careers", "app", "boards", "j"}
GONE = "gone"


def _get(url: str, **params):
    return requests.get(url, params=params, headers=HEADERS, timeout=30)


def links_from_hn() -> set[tuple[str, str]]:
    """Job boards linked from recent Hacker News hiring threads and comments."""
    texts = []
    try:
        hits = _get("https://hn.algolia.com/api/v1/search_by_date", tags="story,author_whoishiring", hitsPerPage=12).json()["hits"]
        ids = [h["objectID"] for h in hits if "who is hiring" in h["title"].lower()][:6]
        with ThreadPoolExecutor(6) as pool:
            texts += list(pool.map(lambda i: _get(f"https://hn.algolia.com/api/v1/items/{i}").text, ids))
    except Exception as e:
        print(f"HN threads skipped: {e}")
    def search(args):
        q, page = args
        try:
            r = _get("https://hn.algolia.com/api/v1/search_by_date", query=q, tags="comment", hitsPerPage=1000, page=page).json()
            return " ".join(h.get("comment_text") or "" for h in r.get("hits", []))
        except Exception:
            return ""
    with ThreadPoolExecutor(8) as pool:
        texts += list(pool.map(search, [(q, p) for q in ["greenhouse.io", "lever.co", "ashbyhq.com", "workable.com",
                                                          "recruitee.com"] for p in range(3)]))
    found = set()
    for text in texts:
        text = unescape(unescape(text.replace("\\/", "/"))).lower()
        for ats, pattern in PATTERNS.items():
            for slug in re.findall(pattern, text):
                slug = slug.strip(".-_").split("?")[0]
                if slug and slug not in NOT_SLUGS:
                    found.add((ats, slug))
    return found


def check(board: tuple[str, str]):
    """Number of open jobs, or GONE if the board no longer exists (None if we couldn't tell)."""
    ats, slug = board
    urls = {"greenhouse": f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs",
            "lever": f"https://api.lever.co/v0/postings/{slug}?mode=json",
            "ashby": f"https://api.ashbyhq.com/posting-api/job-board/{slug}",
            "workable": f"https://apply.workable.com/api/v1/widget/accounts/{slug}",
            "recruitee": f"https://{slug}.recruitee.com/api/offers/"}
    try:
        r = _get(urls[ats])
        if r.status_code in (404, 410):
            return GONE
        r.raise_for_status()
        data = r.json()
        jobs = data if isinstance(data, list) else data.get("jobs", data.get("offers", []))
        return len(jobs)
    except Exception:
        return None  # a timeout or a blip: keep the board for now


def main() -> None:
    try:
        with open(CAREER_PAGES_FILE) as f:
            saved = {(ats, s) for ats, slugs in json.load(f).items() for s in slugs}
    except FileNotFoundError:
        saved = set()
    hand_picked = {(ats, s) for ats, slugs in CAREER_PAGES.items() for s in slugs}
    new = links_from_hn() - saved - hand_picked
    print(f"{len(saved)} saved boards, {len(new)} new ones linked from Hacker News")
    boards = sorted(saved | new)
    with ThreadPoolExecutor(48) as pool:
        results = dict(zip(boards, pool.map(check, boards)))
    keep = {b for b in saved if results[b] != GONE}
    added = {b for b in new if isinstance(results[b], int) and results[b] > 0}  # new ones only with open jobs
    print(f"dropped {len(saved - keep)} gone, added {len(added)}, now {len(keep | added)} boards")
    out: dict[str, list[str]] = {}
    for ats, slug in sorted(keep | added):
        out.setdefault(ats, []).append(slug)
    with open(CAREER_PAGES_FILE, "w") as f:
        json.dump(out, f, indent=0, sort_keys=True)
        f.write("\n")


if __name__ == "__main__":
    main()
