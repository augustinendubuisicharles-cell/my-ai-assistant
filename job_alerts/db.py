"""Subscriber storage. Uses DATABASE_URL (Postgres in production, e.g. a free
Neon database); falls back to a local SQLite file for development."""
import os
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import (Boolean, Column, DateTime, ForeignKey, Integer, MetaData, String, Table, Text,
                        UniqueConstraint, create_engine, delete, func, insert, inspect, select, text, update)

metadata = MetaData()

subscribers = Table(
    "subscribers", metadata,
    Column("id", Integer, primary_key=True),
    Column("email", String(320), nullable=False, unique=True),
    Column("keywords", Text, nullable=False),          # comma-separated job titles/skills
    Column("country", String(80), nullable=False, default=""),  # "" = anywhere
    Column("remote_only", Boolean, nullable=False, default=True),  # False = on-site/hybrid near `city`
    Column("city", String(120), nullable=False, default=""),       # preferred area for on-site jobs
    Column("level", String(20), nullable=False, default="any"),  # any | entry | mid
    Column("token", String(64), nullable=False, unique=True),     # for confirm/manage/unsubscribe links
    Column("confirmed", Boolean, nullable=False, default=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("last_sent_at", DateTime(timezone=True)),
    Column("paid_until", DateTime(timezone=True)),      # alerts are sent while this is in the future
    Column("reminded_for", DateTime(timezone=True)),    # paid_until we last sent a renewal reminder for
)

payments = Table(
    "payments", metadata,
    Column("id", Integer, primary_key=True),
    Column("reference", String(100), nullable=False, unique=True),  # our reference; unique = never counted twice
    Column("subscriber_id", Integer, ForeignKey("subscribers.id", ondelete="SET NULL")),
    Column("amount_ngn", Integer, nullable=False),
    Column("paid_at", DateTime(timezone=True), nullable=False),
)

sent_jobs = Table(
    "sent_jobs", metadata,
    Column("id", Integer, primary_key=True),
    Column("subscriber_id", Integer, ForeignKey("subscribers.id", ondelete="CASCADE"), nullable=False),
    Column("job_key", String(500), nullable=False),
    Column("sent_at", DateTime(timezone=True), nullable=False),
    UniqueConstraint("subscriber_id", "job_key"),
)


def _url() -> str:
    url = os.environ.get("DATABASE_URL") or "sqlite:///job_alerts.db"
    # Use the psycopg (v3) driver whether the URL says postgres:// or postgresql://
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            url = "postgresql+psycopg://" + url[len(prefix):]
    return url


engine = create_engine(_url(), pool_pre_ping=True)


def init_db() -> None:
    metadata.create_all(engine)
    # Columns added after the first release (create_all doesn't alter existing tables).
    have = {c["name"] for c in inspect(engine).get_columns("subscribers")}
    added = {"city": "VARCHAR(120) NOT NULL DEFAULT ''", "paid_until": "TIMESTAMP WITH TIME ZONE",
             "reminded_for": "TIMESTAMP WITH TIME ZONE"}
    with engine.begin() as conn:
        for name, sql_type in added.items():
            if name not in have:
                if engine.dialect.name == "sqlite":
                    sql_type = sql_type.replace("TIMESTAMP WITH TIME ZONE", "DATETIME")
                conn.execute(text(f"ALTER TABLE subscribers ADD COLUMN {name} {sql_type}"))


def stats() -> dict:
    """Real numbers for the home page: confirmed subscribers, and jobs emailed in the last 30 days."""
    with engine.begin() as conn:
        users = conn.execute(select(func.count()).select_from(subscribers).where(subscribers.c.paid_until > now())).scalar()
        jobs = conn.execute(select(func.count()).select_from(sent_jobs)
                            .where(sent_jobs.c.sent_at >= now() - timedelta(days=30))).scalar()
    return {"users": users or 0, "jobs_30d": jobs or 0}


def now() -> datetime:
    return datetime.now(timezone.utc)


def upsert_subscriber(email: str, keywords: str, country: str, remote_only: bool, level: str, city: str = "") -> dict:
    """Creates a subscriber (unconfirmed) or updates the preferences of an existing one."""
    email = email.strip().lower()
    with engine.begin() as conn:
        row = conn.execute(select(subscribers).where(subscribers.c.email == email)).mappings().first()
        values = {"keywords": keywords, "country": country, "remote_only": remote_only, "level": level, "city": city}
        if row:
            conn.execute(update(subscribers).where(subscribers.c.id == row["id"]).values(**values))
        else:
            conn.execute(insert(subscribers).values(
                email=email, token=secrets.token_urlsafe(32), confirmed=False, created_at=now(), **values))
        return dict(conn.execute(select(subscribers).where(subscribers.c.email == email)).mappings().first())


def by_email(email: str) -> dict | None:
    with engine.begin() as conn:
        row = conn.execute(select(subscribers).where(subscribers.c.email == email.strip().lower())).mappings().first()
        return dict(row) if row else None


def by_token(token: str) -> dict | None:
    with engine.begin() as conn:
        row = conn.execute(select(subscribers).where(subscribers.c.token == token)).mappings().first()
        return dict(row) if row else None


def confirm(token: str) -> dict | None:
    with engine.begin() as conn:
        conn.execute(update(subscribers).where(subscribers.c.token == token).values(confirmed=True))
    return by_token(token)


def update_prefs(token: str, keywords: str, country: str, remote_only: bool, level: str, city: str = "") -> None:
    with engine.begin() as conn:
        conn.execute(update(subscribers).where(subscribers.c.token == token).values(
            keywords=keywords, country=country, remote_only=remote_only, level=level, city=city))


def remove(token: str) -> bool:
    """Deletes the subscriber and everything stored about them."""
    with engine.begin() as conn:
        row = conn.execute(select(subscribers.c.id).where(subscribers.c.token == token)).first()
        if not row:
            return False
        conn.execute(delete(sent_jobs).where(sent_jobs.c.subscriber_id == row.id))
        conn.execute(update(payments).where(payments.c.subscriber_id == row.id).values(subscriber_id=None))
        conn.execute(delete(subscribers).where(subscribers.c.id == row.id))
        return True


def confirmed_subscribers() -> list[dict]:
    with engine.begin() as conn:
        return [dict(r) for r in conn.execute(select(subscribers).where(subscribers.c.confirmed.is_(True))).mappings()]


def _aware(dt: datetime | None) -> datetime | None:
    # SQLite hands back naive datetimes; everything here is UTC.
    return dt.replace(tzinfo=timezone.utc) if dt and dt.tzinfo is None else dt


def is_paid(sub: dict) -> bool:
    return bool(sub.get("paid_until")) and _aware(sub["paid_until"]) > now()


def record_payment(reference: str, subscriber_id: int, amount_ngn: int, period_days: int) -> dict | None:
    """Adds `period_days` to the subscriber's paid time, once per payment reference
    (the browser return and the webhook can both report the same payment)."""
    with engine.begin() as conn:
        sub = conn.execute(select(subscribers).where(subscribers.c.id == subscriber_id)).mappings().first()
        if not sub:
            return None
        seen = conn.execute(select(payments.c.id).where(payments.c.reference == reference)).first()
        if not seen:
            start = max(now(), _aware(sub["paid_until"]) or now())
            conn.execute(insert(payments).values(reference=reference, subscriber_id=sub["id"], amount_ngn=amount_ngn,
                                                 paid_at=now()))
            # Paying also confirms the email: they reached the payment page from their inbox.
            conn.execute(update(subscribers).where(subscribers.c.id == sub["id"]).values(
                paid_until=start + timedelta(days=period_days), confirmed=True))
        return dict(conn.execute(select(subscribers).where(subscribers.c.id == sub["id"])).mappings().first())


def start_trial(subscriber_id: int, days: int) -> dict | None:
    """Gives `days` of free alerts to someone who has never had any (trial or paid)."""
    with engine.begin() as conn:
        conn.execute(update(subscribers).where(subscribers.c.id == subscriber_id, subscribers.c.paid_until.is_(None))
                     .values(paid_until=now() + timedelta(days=days)))
        row = conn.execute(select(subscribers).where(subscribers.c.id == subscriber_id)).mappings().first()
        return dict(row) if row else None


def mark_reminded(subscriber_id: int, paid_until: datetime) -> None:
    with engine.begin() as conn:
        conn.execute(update(subscribers).where(subscribers.c.id == subscriber_id).values(reminded_for=paid_until))


def already_sent(subscriber_id: int) -> set[str]:
    with engine.begin() as conn:
        return {r.job_key for r in conn.execute(select(sent_jobs.c.job_key).where(sent_jobs.c.subscriber_id == subscriber_id))}


def record_sent(subscriber_id: int, job_keys: list[str]) -> None:
    with engine.begin() as conn:
        for key in job_keys:
            conn.execute(insert(sent_jobs).values(subscriber_id=subscriber_id, job_key=key[:500], sent_at=now()))
        conn.execute(update(subscribers).where(subscribers.c.id == subscriber_id).values(last_sent_at=now()))
