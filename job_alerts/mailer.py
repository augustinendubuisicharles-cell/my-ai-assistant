"""Sends email through Resend's web API when RESEND_API_KEY is set, else Brevo's when
BREVO_API_KEY is set, otherwise over SMTP. Render's free plan blocks outgoing SMTP ports, so the website must use the
API; the daily GitHub Actions job can use either.

Env: RESEND_API_KEY, or BREVO_API_KEY, or SMTP_HOST, SMTP_PORT (465 = SSL, otherwise STARTTLS),
SMTP_USER, SMTP_PASSWORD; plus FROM_EMAIL (defaults to SMTP_USER).
"""
import os
import smtplib
from email.message import EmailMessage
from email.utils import formataddr

import requests

FROM_NAME = os.environ.get("FROM_NAME", "Job Alerts")


def _env(name: str, default: str = "") -> str:
    # Secrets pasted from a dashboard often carry a stray newline or space.
    return (os.environ.get(name) or default).strip()


def _send_brevo_api(key: str, to: str, subject: str, text: str, html: str, unsubscribe_url: str | None) -> None:
    payload = {"sender": {"name": FROM_NAME, "email": _env("FROM_EMAIL") or _env("SMTP_USER")},
               "to": [{"email": to}], "subject": subject, "htmlContent": html, "textContent": text}
    if unsubscribe_url:
        payload["headers"] = {"List-Unsubscribe": f"<{unsubscribe_url}>"}
    r = requests.post("https://api.brevo.com/v3/smtp/email", json=payload, timeout=20,
                      headers={"api-key": key, "accept": "application/json"})
    if r.status_code >= 300:
        raise RuntimeError(f"Brevo API {r.status_code}: {r.text[:300]}")


def _send_resend(key: str, to: str, subject: str, text: str, html: str, unsubscribe_url: str | None) -> None:
    payload = {"from": formataddr((FROM_NAME, _env("FROM_EMAIL") or _env("SMTP_USER"))), "to": [to],
               "subject": subject, "html": html, "text": text}
    if unsubscribe_url:
        payload["headers"] = {"List-Unsubscribe": f"<{unsubscribe_url}>"}
    r = requests.post("https://api.resend.com/emails", json=payload, timeout=20,
                      headers={"Authorization": f"Bearer {key}"})
    if r.status_code >= 300:
        raise RuntimeError(f"Resend API {r.status_code}: {r.text[:300]}")


def send(to: str, subject: str, text: str, html: str, unsubscribe_url: str | None = None) -> None:
    if key := _env("RESEND_API_KEY"):
        return _send_resend(key, to, subject, text, html, unsubscribe_url)
    if key := _env("BREVO_API_KEY"):
        return _send_brevo_api(key, to, subject, text, html, unsubscribe_url)
    host = _env("SMTP_HOST", "smtp.gmail.com")
    port = int(_env("SMTP_PORT", "465"))
    user, password = _env("SMTP_USER"), _env("SMTP_PASSWORD")

    msg = EmailMessage()
    msg["From"] = formataddr((FROM_NAME, _env("FROM_EMAIL") or user))
    msg["To"] = to
    msg["Subject"] = subject
    if unsubscribe_url:
        msg["List-Unsubscribe"] = f"<{unsubscribe_url}>"
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=15) as smtp:
            smtp.login(user, password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=15) as smtp:
            smtp.starttls()
            smtp.login(user, password)
            smtp.send_message(msg)
