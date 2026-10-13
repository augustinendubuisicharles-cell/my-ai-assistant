"""Subscriber storage. Uses DATABASE_URL (Postgres in production, e.g. a free
Neon database); falls back to a local SQLite file for development."""
import os
import secrets
from datetime import datetime, timezone

from sqlalchemy import (Boolean, Column, DateTime, ForeignKey, Integer, MetaData, String, Table, Text,
                        UniqueConstraint, create_engine, delete, insert, select, update)

metadata = MetaData()

subscribers = Table(
    "subscribers", metadata,
    Column("id", Integer, primary_key=True),
    Column("email", String(320), nullable=False, unique=True),
    Column("keywords", Text, nullable=False),          # comma-separated job titles/skills
    Column("country", String(80), nullable=False, default=""),  # "" = anywhere
    Column("remote_only", Boolean, nullable=False, default=True),
    Column("level", String(20), nullable=False, default="any"),  # any | entry | mid
    Column("token", String(64), nullable=False, unique=True),     # for confirm/manage/unsubscribe links
    Column("confirmed", Boolean, nullable=False, default=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("last_sent_at", DateTime(timezone=True)),
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


def now() -> datetime:
    return datetime.now(timezone.utc)


def upsert_subscriber(email: str, keywords: str, country: str, remote_only: bool, level: str) -> dict:
    """Creates a subscriber (unconfirmed) or updates the preferences of an existing one."""
    email = email.strip().lower()
    with engine.begin() as conn:
        row = conn.execute(select(subscribers).where(subscribers.c.email == email)).mappings().first()
        values = {"keywords": keywords, "country": country, "remote_only": remote_only, "level": level}
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


def update_prefs(token: str, keywords: str, country: str, remote_only: bool, level: str) -> None:
    with engine.begin() as conn:
        conn.execute(update(subscribers).where(subscribers.c.token == token).values(
            keywords=keywords, country=country, remote_only=remote_only, level=level))


def remove(token: str) -> bool:
    """Deletes the subscriber and everything stored about them."""
    with engine.begin() as conn:
        row = conn.execute(select(subscribers.c.id).where(subscribers.c.token == token)).first()
        if not row:
            return False
        conn.execute(delete(sent_jobs).where(sent_jobs.c.subscriber_id == row.id))
        conn.execute(delete(subscribers).where(subscribers.c.id == row.id))
        return True


def confirmed_subscribers() -> list[dict]:
    with engine.begin() as conn:
        return [dict(r) for r in conn.execute(select(subscribers).where(subscribers.c.confirmed.is_(True))).mappings()]


def already_sent(subscriber_id: int) -> set[str]:
    with engine.begin() as conn:
        return {r.job_key for r in conn.execute(select(sent_jobs.c.job_key).where(sent_jobs.c.subscriber_id == subscriber_id))}


def record_sent(subscriber_id: int, job_keys: list[str]) -> None:
    with engine.begin() as conn:
        for key in job_keys:
            conn.execute(insert(sent_jobs).values(subscriber_id=subscriber_id, job_key=key[:500], sent_at=now()))
        conn.execute(update(subscribers).where(subscribers.c.id == subscriber_id).values(last_sent_at=now()))
