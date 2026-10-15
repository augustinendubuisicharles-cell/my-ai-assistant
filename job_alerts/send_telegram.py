"""Run every two hours in the day (by .github/workflows/job_alerts_telegram.yml): sends paying members who
connected Telegram or WhatsApp any new matches straight away, so they can apply before the morning email.
Jobs sent here are remembered, so the morning email won't repeat them.

Run from the repo root:  python -m job_alerts.send_telegram
Needs DATABASE_URL, plus JOB_ALERTS_TELEGRAM_TOKEN (the bot people connect to from their manage page)
and/or WHATSAPP_TOKEN + WHATSAPP_PHONE_ID (WhatsApp Cloud API). Each channel stays off until its keys are set.
WhatsApp only lets businesses start a chat with an approved template: WHATSAPP_TEMPLATE (default "job_alert"),
English, with three body variables: {{1}} job title, {{2}} company, {{3}} link.
"""
import os
import sys
import time
from html import escape

import requests

from . import db, payments
from .search import find_jobs, job_key
from .send_daily import first_titles

PER_RUN = 3  # at most this many jobs per member each run, so alerts stay useful rather than noisy
WHATSAPP_API = "https://graph.facebook.com/v21.0"


def send(token: str, chat_id: str, html: str) -> None:
    r = requests.post(f"https://api.telegram.org/bot{token}/sendMessage", timeout=20,
                      json={"chat_id": chat_id, "text": html, "parse_mode": "HTML", "disable_web_page_preview": True})
    r.raise_for_status()


def message(job: dict) -> str:
    company = f" at <b>{escape(job['company'])}</b>" if job["company"] else ""
    return (f"🔔 <a href=\"{escape(job['url'], quote=True)}\"><b>{escape(job['title'])}</b></a>{company}\n"
            f"<i>{escape(', '.join(job['matched']))}</i> (via {escape(job['source'])})")


def send_whatsapp(token: str, phone_id: str, to: str, job: dict, link: str) -> None:
    params = [job["title"][:200], job["company"][:100] or "a company hiring now", link]
    r = requests.post(f"{WHATSAPP_API}/{phone_id}/messages", timeout=20, headers={"Authorization": f"Bearer {token}"},
                      json={"messaging_product": "whatsapp", "to": to, "type": "template",
                            "template": {"name": os.environ.get("WHATSAPP_TEMPLATE") or "job_alert", "language": {"code": "en"},
                                         "components": [{"type": "body", "parameters": [{"type": "text", "text": p} for p in params]}]}})
    if not r.ok:
        raise RuntimeError(f"WhatsApp {r.status_code}: {r.text[:300]}")


def main() -> None:
    tg = os.environ.get("JOB_ALERTS_TELEGRAM_TOKEN", "").strip()
    wa, wa_phone = os.environ.get("WHATSAPP_TOKEN", "").strip(), os.environ.get("WHATSAPP_PHONE_ID", "").strip()
    wa = wa if wa and wa_phone else ""
    if not tg and not wa:
        print("Neither JOB_ALERTS_TELEGRAM_TOKEN nor WHATSAPP_TOKEN + WHATSAPP_PHONE_ID is set -- instant alerts are off.")
        return
    base_url = os.environ.get("BASE_URL", "").rstrip("/")
    db.init_db()
    paid_ids = db.paid_subscriber_ids()
    members = [s for s in db.confirmed_subscribers()
               if ((tg and s.get("telegram_chat_id")) or (wa and s.get("whatsapp"))) and db.is_member(s, paid_ids)]
    print(f"{len(members)} member(s) with instant alerts connected"
          f" (Telegram {'on' if tg else 'off'}, WhatsApp {'on' if wa else 'off'}).")
    sent = failed = 0
    for sub in members:
        try:
            jobs = find_jobs(first_titles(sub["keywords"], payments.PAID_LIMITS[1]), sub["country"], sub["remote_only"],
                             sub["level"], db.already_sent(sub["id"]), n=PER_RUN, city=sub.get("city") or "",
                             hours=sub.get("hours") or "any")
            for job in jobs:
                # one at a time, so a failure mid-way doesn't lose track; the row id makes the job-page link
                job_id = db.record_sent(sub["id"], [{**job, "key": job_key(job)}])[0]
                delivered = False
                try:
                    if tg and sub.get("telegram_chat_id"):
                        send(tg, sub["telegram_chat_id"], message(job))
                        delivered = True
                    if wa and sub.get("whatsapp"):
                        link = f"{base_url}/j/{sub['token']}/{job_id}" if base_url else job["url"]
                        send_whatsapp(wa, wa_phone, sub["whatsapp"], job, link)
                        delivered = True
                except Exception:
                    if not delivered:
                        db.unsend([job_id])  # nothing reached them: let the morning email have it
                    raise
                time.sleep(0.5)
            sent += len(jobs)
            print(f"- subscriber {sub['id']}: {len(jobs)} instant alert(s)")
        except Exception as e:  # one bad subscriber shouldn't stop the rest
            failed += 1
            print(f"- subscriber {sub['id']}: FAILED {e}")
    print(f"Done: {sent} job(s) sent, {failed} failed.")
    if failed and not sent:
        sys.exit(1)


if __name__ == "__main__":
    main()
