"""Proves the database works: creates the tables, adds a test subscriber,
reads it back, records a sent job, then deletes everything it added.

Run from the repo root:  DATABASE_URL=... python -m job_alerts.check_db
"""
import secrets

from . import db


def main() -> None:
    print(f"Connecting to {db.engine.url.render_as_string(hide_password=True)}")
    db.init_db()
    email = f"db-check-{secrets.token_hex(4)}@example.invalid"
    sub = db.upsert_subscriber(email, "db check", "Nigeria", True, "entry")
    print(f"Inserted test subscriber {sub['id']}")
    assert db.by_email(email)["keywords"] == "db check"
    db.confirm(sub["token"])
    assert any(s["email"] == email for s in db.confirmed_subscribers())
    db.record_sent(sub["id"], ["https://example.invalid/job"])
    assert db.already_sent(sub["id"]) == {"https://example.invalid/job"}
    assert db.remove(sub["token"]) and db.by_email(email) is None
    print("Read, update, sent-job tracking and delete all worked. Test data removed.")


if __name__ == "__main__":
    main()
