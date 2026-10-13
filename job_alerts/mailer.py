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


def send(to: str, subject: str, text: str, html: str, unsubscribe_url: str | None = None) -> None:
    host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("SMTP_PORT", "465"))
    user, password = os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"]

    msg = EmailMessage()
    msg["From"] = formataddr((FROM_NAME, os.environ.get("FROM_EMAIL") or user))
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
