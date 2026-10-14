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
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from . import db, emails, mailer, payments
from .search import COUNTRIES

SITE_NAME = os.environ.get("SITE_NAME", "Job Alerts")
CONTACT_EMAIL = os.environ.get("CONTACT_EMAIL") or os.environ.get("FROM_EMAIL", "")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

app = FastAPI(title=SITE_NAME, docs_url=None, redoc_url=None)
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
db.init_db()


def _base_url(request: Request) -> str:
    return (os.environ.get("BASE_URL") or str(request.base_url)).rstrip("/")


def _page(request: Request, name: str, **ctx) -> HTMLResponse:
    return templates.TemplateResponse(request, name, {
        "site_name": SITE_NAME, "base_url": _base_url(request), "paid_service": payments.enabled(), "provider": payments.provider(),
        "price": f"₦{payments.PRICE_NGN:,}", "months": round(payments.PERIOD_DAYS / 30), "trial_days": payments.TRIAL_DAYS, "contact": CONTACT_EMAIL, **ctx})


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
    if not sub["paid_until"]:
        sub = db.start_trial(sub["id"], payments.TRIAL_DAYS)
    if not db.is_paid(sub):  # trial (or paid time) already used up
        if payments.enabled():
            return _pay_page(request, sub, heading="Email confirmed. Pick up where you left off")
        return _message(request, "Email confirmed", "Your free trial has ended. We'll email you when paid plans open.")
    return _message(request, "You're in!", f"Your free {payments.TRIAL_DAYS}-day trial runs until "
                    f"{db._aware(sub['paid_until']):%d %b %Y}. Your first matches arrive tomorrow morning.", ok=True,
                    link=f"/manage/{token}", link_text="Change my preferences")


@app.get("/manage/{token}", response_class=HTMLResponse)
def manage(request: Request, token: str):
    sub = db.by_token(token)
    if not sub:
        return _message(request, "Link not recognised", "This link is invalid or you've already unsubscribed.", status=404)
    return _page(request, "form.html", sub=sub, countries=list(COUNTRIES), action=f"/manage/{token}", button="Save",
                 heading="Your job alerts", lead=f"Alerts for {sub['email']}", status=_status(sub))


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


def _status(sub: dict) -> str:
    if db.is_paid(sub):
        return f"Active until {db._aware(sub['paid_until']):%d %b %Y}."
    if not sub.get("confirmed"):
        return ""
    return "Not active. Pay to start receiving jobs." if payments.enabled() else "Your free trial has ended."


def _pay_page(request: Request, sub: dict, heading: str) -> HTMLResponse:
    return _page(request, "pay.html", sub=sub, heading=heading, status=_status(sub))


@app.get("/pay/{token}", response_class=HTMLResponse)
def pay(request: Request, token: str):
    sub = db.by_token(token)
    if not sub or not payments.enabled():
        return _message(request, "Link not recognised", "This link is invalid or you've already unsubscribed.", status=404)
    return _pay_page(request, sub, heading="Renew your job alerts" if sub.get("paid_until") else "Start your job alerts")


@app.post("/pay/{token}")
def checkout(request: Request, token: str):
    sub = db.by_token(token)
    if not sub or not payments.enabled():
        return _message(request, "Link not recognised", "This link is invalid or you've already unsubscribed.", status=404)
    try:
        url = payments.start_checkout(sub["email"], sub["id"], f"{_base_url(request)}/paid")
    except Exception as e:
        print(f"[checkout] subscriber {sub['id']}: {e}")
        return _message(request, "Payment page unavailable", "Please try again in a few minutes.",
                        link=f"/pay/{token}", link_text="Try again", status=502)
    return RedirectResponse(url, status_code=303)


def _apply_payment(reference: str) -> dict | None:
    paid = payments.verify(reference)
    return db.record_payment(paid["reference"], paid["subscriber_id"], paid["amount"], payments.PERIOD_DAYS) if paid else None


@app.get("/paid", response_class=HTMLResponse)
def paid(request: Request, reference: str = "", trxref: str = "", transRef: str = ""):
    ref = transRef or reference or trxref  # Credo sends transRef; Paystack sends reference
    try:
        sub = _apply_payment(ref)
    except Exception as e:
        print(f"[paid] {ref}: {e}")
        sub = None
    if not sub:
        return _message(request, "We couldn't confirm your payment yet",
                        "If you were charged, it will show on your account within a few minutes and we'll email you. "
                        f"Otherwise you can try again from the link in your email{f' or contact {CONTACT_EMAIL}' if CONTACT_EMAIL else ''}.",
                        status=402)
    return _message(request, "Payment received. You're in!",
                    f"Your alerts are active until {db._aware(sub['paid_until']):%d %b %Y}. Your first matches arrive tomorrow morning.",
                    ok=True, link=f"/manage/{sub['token']}", link_text="Change my preferences")


@app.post("/payments/webhook")
async def webhook(request: Request):
    """The payment provider calls this on every successful charge, so a payment counts
    even if the buyer closed the page before coming back. Each one is re-checked with the provider."""
    body = await request.body()
    if not payments.enabled():
        return HTMLResponse("payments off", status_code=404)
    try:
        ref = payments.webhook_ref(body, request.headers)
    except PermissionError:
        return HTMLResponse("bad signature", status_code=401)
    except ValueError:
        return HTMLResponse("bad body", status_code=400)
    try:
        if ref:
            _apply_payment(ref)
    except Exception as e:
        print(f"[webhook] {e}")
    return HTMLResponse("ok")


@app.get("/terms", response_class=HTMLResponse)
def terms(request: Request):
    return _page(request, "terms.html")


@app.get("/healthz")
def healthz():
    return {"ok": True}
