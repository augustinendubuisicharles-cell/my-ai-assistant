"""Sends email over SMTP. Works with Gmail for testing, but for real users use a
transactional email service (e.g. Brevo's free SMTP relay) -- Gmail caps sending
and flags bulk mail to strangers.

Env: SMTP_HOST, SMTP_PORT (465 = SSL, otherwise STARTTLS), SMTP_USER,
SMTP_PASSWORD, FROM_EMAIL (defaults to SMTP_USER).
"""
import os
import smtplib
from email.message import EmailMessage
from email.utils import formataddr

FROM_NAME = os.environ.get("FROM_NAME", "Job Alerts")


def _env(name: str, default: str = "") -> str:
    # Secrets pasted from a dashboard often carry a stray newline or space.
    return (os.environ.get(name) or default).strip()


def send(to: str, subject: str, text: str, html: str, unsubscribe_url: str | None = None) -> None:
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
        with smtplib.SMTP_SSL(host, port, timeout=30) as smtp:
            smtp.login(user, password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=30) as smtp:
            smtp.starttls()
            smtp.login(user, password)
            smtp.send_message(msg)
