"""The daily check-up robot: looks for problems after the morning emails and emails the owner a short report.

It only reads and reports: it never changes an account or emails a subscriber.
Run from the repo root:  DATABASE_URL=... OWNER_EMAIL=... python -m job_alerts.health_check
Without OWNER_EMAIL the report is only printed (in the workflow's log, which never shows addresses).
"""
import os
from datetime import datetime, timedelta, timezone
from html import escape

import requests
from sqlalchemy import text

from . import db, mailer, payments, search

SITE = (os.environ.get("BASE_URL") or "https://jobalert.me.uk").strip().rstrip("/")
BREVO_LOW = 500  # emails left this month before it's worth a warning


def _rows(sql: str, **params) -> list[dict]:
    with db.engine.begin() as conn:
        return [dict(r) for r in conn.execute(text(sql), params).mappings()]


def _who(rows: list[dict], limit: int = 8) -> str:
    """Subscriber numbers, never addresses (the report can end up in a log)."""
    ids = [f"#{r['id']}" for r in rows[:limit]]
    return ", ".join(ids) + (f" and {len(rows) - limit} more" if len(rows) > limit else "")


def check_morning(problems: list, notes: list) -> None:
    """Everyone with active alerts should have been searched this morning, without errors."""
    cutoff = datetime.now(timezone.utc).replace(hour=5, minute=0, second=0, microsecond=0)
    active = _rows("SELECT id, last_run_at, last_run_result, created_at FROM subscribers "
                   "WHERE confirmed AND paid_until > now()")
    missed = [r for r in active if r["last_run_at"] and r["last_run_at"] < cutoff]
    failed = [r for r in active if (r["last_run_result"] or "").lower().startswith(("fail", "error"))]
    empty = [r for r in active if (r["last_run_result"] or "").lower().startswith("no new")]
    never = [r for r in active if not r["last_run_at"] and r["created_at"] < datetime.now(timezone.utc) - timedelta(hours=1)]
    notes.append(f"{len(active)} people have active alerts.")
    if missed:
        problems.append(f"{len(missed)} active people were not searched this morning ({_who(missed)}). The morning run may have stopped early.")
    if failed:
        problems.append(f"{len(failed)} searches failed this morning ({_who(failed)}): \"{failed[0]['last_run_result'][:80]}\"")
    if empty:
        problems.append(f"{len(empty)} active people got no new jobs today ({_who(empty)}).")
    if never:
        problems.append(f"{len(never)} confirmed people were never searched ({_who(never)}). Their first search didn't start.")


def check_signups(problems: list, notes: list) -> None:
    new = _rows("SELECT id, confirmed FROM subscribers WHERE created_at > now() - interval '24 hours'")
    stuck = [r for r in new if not r["confirmed"]]
    notes.append(f"{len(new)} sign-ups in the last 24 hours, {len(new) - len(stuck)} confirmed.")
    if len(new) >= 4 and len(stuck) / len(new) > 0.6:
        problems.append(f"{len(stuck)} of {len(new)} sign-ups in the last 24 hours haven't confirmed. Confirmation emails may not be arriving.")


def check_rules(problems: list) -> None:
    """Owner's rules on what each person is sent, checked on today's emails."""
    paid_ids = db.paid_subscriber_ids()
    today = _rows("SELECT j.subscriber_id AS id, s.country, s.remote_only, s.hours, s.paid_until, j.title, j.url, j.location, "
                  "j.matched, j.description, date_trunc('minute', j.sent_at) AS batch FROM sent_jobs j "
                  "JOIN subscribers s ON s.id = j.subscriber_id WHERE j.sent_at > now() - interval '20 hours'")
    by_email: dict[tuple, int] = {}  # one email = one subscriber's jobs saved in the same minute
    for r in today:
        by_email[(r["id"], r["batch"])] = by_email.get((r["id"], r["batch"]), 0) + 1
    over = [{"id": i} for i in dict.fromkeys(i for (i, _), n in by_email.items() if i not in paid_ids and n > payments.TRIAL_LIMITS[0])]
    if over:
        problems.append(f"{len(over)} trial accounts got an email with more than {payments.TRIAL_LIMITS[0]} jobs today ({_who(over)}). That breaks the 3-jobs rule.")
    wrong_place = []
    for r in today:
        job = {"title": r["title"] or "", "location": r["location"] or "", "desc": r["description"] or "",
               "remote": r["remote_only"] or "remote" in f"{r['location']} {r['matched']}".lower(), "job_type": ""}
        country = r["country"] or search.DEFAULT_COUNTRY  # "Any country" accounts only get jobs open to Nigerians
        if not (search.location_fits(job["location"], country, job["remote"]) and search.open_to(job, country)):
            wrong_place.append(r)
    if wrong_place:
        eg = wrong_place[0]
        problems.append(f"{len(wrong_place)} jobs sent today may not be open to the person's country "
                        f"(e.g. #{eg['id']}: \"{eg['title'][:60]}\", {eg['location'][:40] or 'no location'}).")
    twice = _rows("SELECT subscriber_id AS id, url, count(*) AS n FROM sent_jobs WHERE url IS NOT NULL AND url <> '' "
                  "GROUP BY subscriber_id, url HAVING count(*) > 1 AND max(sent_at) > now() - interval '20 hours'")
    if twice:
        problems.append(f"{len(twice)} jobs were sent again to someone who already had them ({_who(twice)}).")
    part = [r for r in today if r["hours"] == "part"]
    full = [r for r in part if "full-time" in (r["matched"] or "")]
    if part and len(full) / len(part) > 0.5:
        problems.append(f"{len(full)} of {len(part)} jobs sent to part-time users today were full-time top-ups.")


def check_payments(problems: list, notes: list) -> None:
    """Paystack payments from the last 3 days that we never recorded."""
    key = os.environ.get("PAYSTACK_SECRET_KEY", "").strip()
    if not key:
        notes.append("Payments not checked (no Paystack key here).")
        return
    since = (datetime.now(timezone.utc) - timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        r = requests.get("https://api.paystack.co/transaction", timeout=30, headers={"Authorization": f"Bearer {key}"},
                         params={"status": "success", "from": since, "perPage": 100})
        r.raise_for_status()
        refs = {t["reference"] for t in r.json().get("data") or [] if t.get("currency") == "NGN"}
    except Exception as e:
        problems.append(f"Couldn't read payments from Paystack: {str(e)[:100]}")
        return
    known = {row["reference"] for row in _rows("SELECT reference FROM payments")}
    missing = sorted(refs - known)
    notes.append(f"{len(refs)} Paystack payments in the last 3 days.")
    if missing:
        problems.append(f"{len(missing)} Paystack payments aren't recorded as memberships (e.g. reference {missing[0]}).")


def check_site(problems: list) -> None:
    for path, must in (("/", "JobAlert"), ("/login", "email"), ("/admin", "password")):
        try:
            r = requests.get(SITE + path, timeout=20)
            if r.status_code != 200 or must.lower() not in r.text.lower():
                problems.append(f"The page {SITE}{path} isn't working (status {r.status_code}).")
        except Exception as e:
            problems.append(f"The page {SITE}{path} didn't load: {str(e)[:80]}")


def check_brevo(problems: list, notes: list) -> None:
    if os.environ.get("RESEND_API_KEY", "").strip():
        notes.append("Email: sent through Resend.")
        return
    key = os.environ.get("BREVO_API_KEY", "").strip()
    if not key:
        return
    try:
        r = requests.get("https://api.brevo.com/v3/account", timeout=20, headers={"api-key": key, "accept": "application/json"})
        r.raise_for_status()
        left = sum(p.get("credits") or 0 for p in r.json().get("plan") or [] if p.get("creditsType") == "sendLimit")
    except Exception as e:
        problems.append(f"Couldn't read the Brevo account: {str(e)[:100]}")
        return
    notes.append(f"Brevo: {left:,} emails left this month.")
    if left < BREVO_LOW:
        problems.append(f"Only {left:,} Brevo emails left this month. Emails will stop when it runs out.")


def report() -> tuple[list[str], list[str]]:
    problems, notes = [], []
    for check in (check_morning, check_signups, check_payments, check_brevo):
        try:
            check(problems, notes)
        except Exception as e:
            problems.append(f"The {check.__name__.removeprefix('check_')} check crashed: {str(e)[:120]}")
    for check in (check_rules, check_site):
        try:
            check(problems)
        except Exception as e:
            problems.append(f"The {check.__name__.removeprefix('check_')} check crashed: {str(e)[:120]}")
    return problems, notes


def main() -> None:
    problems, notes = report()
    day = datetime.now(timezone.utc).strftime("%a %d %b")
    subject = f"JobAlert check-up {day}: " + (f"{len(problems)} to look at" if problems else "all good ✅")
    lines = [f"⚠️ {p}" for p in problems] or ["✅ Nothing wrong found."]
    body = "\n".join(lines + [""] + notes + ["", f"Dashboard: {SITE}/admin"])
    print(subject + "\n\n" + body)
    owner = os.environ.get("OWNER_EMAIL", "").strip()
    if not owner:
        print("\nOWNER_EMAIL isn't set, so the report was only printed here.")
        return
    html = (f"<h2 style='font-family:sans-serif'>{escape(subject)}</h2><ul style='font-family:sans-serif;line-height:1.5'>"
            + "".join(f"<li>{escape(l)}</li>" for l in lines) + "</ul><p style='font-family:sans-serif;color:#667'>"
            + "<br>".join(escape(n) for n in notes) + f"</p><p><a href='{SITE}/admin'>Open the dashboard</a></p>")
    mailer.send(owner, subject, body, html)
    print("\nReport emailed to the owner.")


if __name__ == "__main__":
    main()
