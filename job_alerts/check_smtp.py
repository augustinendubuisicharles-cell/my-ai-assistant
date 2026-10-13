"""Proves the SMTP settings work by logging in, without sending anything.

Run from the repo root:  SMTP_USER=... SMTP_PASSWORD=... python -m job_alerts.check_smtp
"""
import smtplib

from .mailer import _env


def main() -> None:
    host, port = _env("SMTP_HOST", "smtp.gmail.com"), int(_env("SMTP_PORT", "465"))
    print(f"Logging in to {host}:{port} (FROM_EMAIL {'set' if _env('FROM_EMAIL') else 'NOT set'})")
    if port == 465:
        smtp = smtplib.SMTP_SSL(host, port, timeout=30)
    else:
        smtp = smtplib.SMTP(host, port, timeout=30)
        smtp.starttls()
    with smtp:
        smtp.login(_env("SMTP_USER"), _env("SMTP_PASSWORD"))
    print("SMTP login worked. No email was sent.")


if __name__ == "__main__":
    main()
