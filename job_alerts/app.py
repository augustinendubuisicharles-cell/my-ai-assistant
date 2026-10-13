"""Sign-up website: people enter their email and the jobs they want, confirm by
email, and can change or cancel their alerts any time.

Run locally:  uvicorn job_alerts.app:app --reload   (from the repo root)
Env: DATABASE_URL, BASE_URL (the site's public address), SITE_NAME, plus the
email settings in mailer.py (BREVO_API_KEY on Render).
"""
import os
import re
from pathlib import Path

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from . import db, emails, mailer
from .search import COUNTRIES

SITE_NAME = os.environ.get("SITE_NAME", "Job Alerts")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

app = FastAPI(title=SITE_NAME, docs_url=None, redoc_url=None)
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
db.init_db()


def _base_url(request: Request) -> str:
    return (os.environ.get("BASE_URL") or str(request.base_url)).rstrip("/")


def _page(request: Request, name: str, **ctx) -> HTMLResponse:
    return templates.TemplateResponse(request, name, {"site_name": SITE_NAME, "base_url": _base_url(request), **ctx})


def _message(request, heading, message, ok=False, link=None, link_text=None, status=200):
    resp = _page(request, "message.html", heading=heading, message=message, ok=ok, link=link, link_text=link_text)
    resp.status_code = status
    return resp


def _clean_prefs(keywords: str, country: str, level: str, work_type: str, city: str) -> dict | None:
    """Validates the form. Remote is the default; on-site/hybrid needs a preferred city or area."""
    words = [w.strip() for w in keywords.split(",") if w.strip()][:5]
    remote = work_type != "onsite"
    city = "" if remote else " ".join(city.split())[:120]
    if not words or any(len(w) > 60 for w in words) or (not remote and not city):
        return None
    return {"keywords": ", ".join(words), "country": country if country in COUNTRIES else "",
            "level": level if level in ("any", "entry", "mid") else "any", "remote_only": remote, "city": city}


def _stats() -> dict:
    """Live figures for the home page. Counts only appear once they're worth showing; never made up."""
    try:
        s = db.stats()
    except Exception as e:
        print(f"[stats] {e}")
        return {}
    return {k: v for k, v in s.items() if v >= 10}


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return _page(request, "form.html", sub=None, countries=list(COUNTRIES), action="/subscribe", button="Send me jobs",
                 heading=SITE_NAME, stats=_stats(),
                 lead="Remote jobs matched to you and checked for scams, in your inbox every morning. Prefer on-site? Tell us where.")


@app.post("/subscribe", response_class=HTMLResponse)
def subscribe(request: Request, email: str = Form(""), keywords: str = Form(""), country: str = Form(""),
              level: str = Form("any"), work_type: str = Form("remote"), city: str = Form(""), website: str = Form("")):
    if website:  # hidden field only bots fill in
        return _message(request, "Thanks!", "Check your inbox to confirm.")
    prefs = _clean_prefs(keywords, country, level, work_type, city)
    if not EMAIL_RE.match(email.strip()) or not prefs:
        return _message(request, "Something's missing",
                        "Please enter a valid email, at least one job title, and your preferred area if you chose on-site.",
                        link="/", link_text="Go back", status=400)
    existing = db.by_email(email)
    if existing and existing["confirmed"]:
        # Don't let anyone who knows an address change its alerts: email the owner a manage link instead.
        sub, (subject, text, html) = existing, emails.manage_link(_base_url(request), existing["token"])
    else:
        sub = db.upsert_subscriber(email, **prefs)
        subject, text, html = emails.confirmation(_base_url(request), sub["token"])
    try:
        mailer.send(sub["email"], subject, text, html)
    except Exception as e:
        print(f"[confirm email] failed for subscriber {sub['id']}: {e}")
        return _message(request, "We couldn't send your email", "Please try again in a few minutes.", status=502)
    return _message(request, "Check your inbox", f"We've sent a link to {sub['email']}. "
                    "Open it to finish (check spam if you can't see it).", ok=True)


@app.get("/confirm/{token}", response_class=HTMLResponse)
def confirm(request: Request, token: str):
    sub = db.confirm(token)
    if not sub:
        return _message(request, "Link not recognised", "This link is invalid or you've already unsubscribed.", status=404)
    return _message(request, "You're in!", "Your first matches arrive tomorrow morning.", ok=True,
                    link=f"/manage/{token}", link_text="Change my preferences")


@app.get("/manage/{token}", response_class=HTMLResponse)
def manage(request: Request, token: str):
    sub = db.by_token(token)
    if not sub:
        return _message(request, "Link not recognised", "This link is invalid or you've already unsubscribed.", status=404)
    return _page(request, "form.html", sub=sub, countries=list(COUNTRIES), action=f"/manage/{token}", button="Save",
                 heading="Your job alerts", lead=f"Alerts for {sub['email']}")


@app.post("/manage/{token}", response_class=HTMLResponse)
def save(request: Request, token: str, keywords: str = Form(""), country: str = Form(""), level: str = Form("any"),
         work_type: str = Form("remote"), city: str = Form("")):
    prefs = _clean_prefs(keywords, country, level, work_type, city)
    if not db.by_token(token) or not prefs:
        return _message(request, "Couldn't save", "Please enter at least one job title, and your preferred area if you chose on-site.",
                        link=f"/manage/{token}", link_text="Go back", status=400)
    db.update_prefs(token, **prefs)
    return _message(request, "Saved", "Your new preferences apply from the next email.", ok=True)


@app.get("/unsubscribe/{token}", response_class=HTMLResponse)
@app.post("/unsubscribe/{token}", response_class=HTMLResponse)  # one-click unsubscribe from mail apps
def unsubscribe(request: Request, token: str):
    db.remove(token)
    return _message(request, "Unsubscribed", "You won't get any more emails, and your details have been deleted.", ok=True)


@app.get("/healthz")
def healthz():
    return {"ok": True}
