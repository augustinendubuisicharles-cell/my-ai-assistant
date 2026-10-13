"""Proves the SMTP settings work by logging in, without sending anything.

Run from the repo root:  SMTP_USER=... SMTP_PASSWORD=... python -m job_alerts.check_smtp
"""
import os
import smtplib


def main() -> None:
    host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("SMTP_PORT", "465"))
    print(f"Logging in to {host}:{port} (FROM_EMAIL {'set' if os.environ.get('FROM_EMAIL') else 'NOT set'})")
    if port == 465:
        smtp = smtplib.SMTP_SSL(host, port, timeout=30)
    else:
        smtp = smtplib.SMTP(host, port, timeout=30)
        smtp.starttls()
    with smtp:
        smtp.login(os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"])
    print("SMTP login worked. No email was sent.")


if __name__ == "__main__":
    main()
