"""Gives a subscriber free member time (bigger limits, Telegram, cover letters), e.g. for testing or a gift.

    python -m job_alerts.grant you@example.com 365

Recorded as a ₦0 payment so it counts as membership everywhere; run again to add more days.
"""
import sys

from . import db


def main(email: str, days: int) -> None:
    db.init_db()
    sub = db.by_email(email)
    if not sub:
        sys.exit(f"No subscriber with the email {email!r}. Sign up on the site first.")
    sub = db.record_payment(f"gift-{sub['id']}-{db.now():%Y%m%d%H%M%S}", sub["id"], 0, days)
    print(f"Subscriber {sub['id']} is now a member until {sub['paid_until']:%d %b %Y}.")


if __name__ == "__main__":
    if len(sys.argv) != 3 or not sys.argv[2].isdigit() or not 1 <= int(sys.argv[2]) <= 3650:
        sys.exit("Usage: python -m job_alerts.grant EMAIL DAYS (1-3650)")
    main(sys.argv[1], int(sys.argv[2]))
