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
    Column("hours", String(10), nullable=False, default="any", server_default="any"),  # any | full | part (full-time / part-time)
    Column("token", String(64), nullable=False, unique=True),     # for confirm/manage/unsubscribe links
    Column("confirmed", Boolean, nullable=False, default=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("last_sent_at", DateTime(timezone=True)),
    Column("paid_until", DateTime(timezone=True)),      # alerts are sent while this is in the future
    Column("reminded_for", DateTime(timezone=True)),    # paid_until we last sent a renewal reminder for
    Column("telegram_chat_id", String(32)),              # set when a paid member connects Telegram
    Column("cv_text", Text),                             # pasted CV, used for AI cover letters (members)
    Column("ref_code", String(16), unique=True),         # their invite link: /?ref=<ref_code>
    Column("referred_by", Integer),                      # subscriber id whose invite link they used
    Column("ref_rewards", Integer, nullable=False, server_default="0"),  # free months already given for invites
    Column("last_run_at", DateTime(timezone=True)),      # when a job search last ran for them (owner dashboard)
    Column("last_run_result", String(200)),              # what it did: "sent 5 jobs", "no new matches", "FAILED: ..."
    Column("confirm_reminded_at", DateTime(timezone=True)),  # one "please confirm" reminder for unconfirmed sign-ups
    Column("titles_tip_at", DateTime(timezone=True)),    # one "try broader job titles" email when nothing ever matched
)

payments = Table(
    "payments", metadata,
    Column("id", Integer, primary_key=True),
    Column("reference", String(100), nullable=False, unique=True),  # our reference; unique = never counted twice
    Column("subscriber_id", Integer, ForeignKey("subscribers.id", ondelete="SET NULL")),
    Column("amount_ngn", Integer, nullable=False),
    Column("paid_at", DateTime(timezone=True), nullable=False),
)

letters = Table(  # one row per AI cover letter or tailored CV written, for the daily limits
    "letters", metadata,
    Column("id", Integer, primary_key=True),
    Column("subscriber_id", Integer, ForeignKey("subscribers.id", ondelete="CASCADE"), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("kind", String(10), nullable=False, server_default="letter"),  # "letter" or "cv"
)

sent_jobs = Table(
    "sent_jobs", metadata,
    Column("id", Integer, primary_key=True),
    Column("subscriber_id", Integer, ForeignKey("subscribers.id", ondelete="CASCADE"), nullable=False),
    Column("job_key", String(500), nullable=False),
    Column("sent_at", DateTime(timezone=True), nullable=False),
    # Members' application tracker: the job itself, so it can be shown again or listed on their tracker page.
    Column("title", String(300)),
    Column("company", String(200)),
    Column("url", String(1000)),
    Column("source", String(60)),
    Column("posted_at", DateTime(timezone=True)),
    # The advert itself, for the job's own page on the site (/j/<token>/<id>).
    Column("location", String(200)),
    Column("pay", String(120)),
    Column("matched", String(500)),                      # why it was picked, " · "-separated
    Column("description", Text),
    Column("clicked_at", DateTime(timezone=True)),       # they opened Apply, or made a CV or letter for it
    Column("asked_count", Integer, nullable=False, server_default="0"),  # mornings we asked "Did you apply?"
    Column("status", String(20)),                        # STATUSES below; NULL = no answer yet
    Column("status_at", DateTime(timezone=True)),
    UniqueConstraint("subscriber_id", "job_key"),
)


logins = Table(  # members' email sign-in: a one-time link (code) that becomes a 30-day session; both stored hashed
    "logins", metadata,
    Column("id", Integer, primary_key=True),
    Column("subscriber_id", Integer, ForeignKey("subscribers.id", ondelete="CASCADE"), nullable=False),
    Column("code_hash", String(64), nullable=False, unique=True),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("used_at", DateTime(timezone=True)),
    Column("session_hash", String(64), unique=True),
    Column("expires_at", DateTime(timezone=True)),
)


def _url() -> str:
    url = os.environ.get("DATABASE_URL") or "sqlite:///job_alerts.db"
    # Use the psycopg (v3) driver whether the URL says postgres:// or postgresql://
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            url = "postgresql+psycopg://" + url[len(prefix):]
    return url


engine = create_engine(_url(), pool_pre_ping=True)


SENT_JOB_COLUMNS = {"title": "VARCHAR(300)", "company": "VARCHAR(200)", "url": "VARCHAR(1000)", "source": "VARCHAR(60)",
                    "posted_at": "TIMESTAMP WITH TIME ZONE", "location": "VARCHAR(200)", "pay": "VARCHAR(120)",
                    "matched": "VARCHAR(500)", "description": "TEXT", "clicked_at": "TIMESTAMP WITH TIME ZONE",
                    "asked_count": "INTEGER NOT NULL DEFAULT 0", "status": "VARCHAR(20)", "status_at": "TIMESTAMP WITH TIME ZONE"}
# Tracker answers. "not_yet" jobs come back each morning while they're fresh; "skip" ones never do.
STATUSES = ("applied", "not_yet", "skip", "interview", "offer", "no_reply")
ASK_MORNINGS = 2      # how many mornings we ask "Did you apply?" about a job they opened
DESCRIPTION_MAX = 8000     # characters of the advert kept for its page
FRESH = timedelta(days=7)  # same as search.MAX_AGE: older adverts stop coming back


def init_db() -> None:
    metadata.create_all(engine)
    # Columns added after the first release (create_all doesn't alter existing tables).
    have = {c["name"] for c in inspect(engine).get_columns("subscribers")}
    added = {"city": "VARCHAR(120) NOT NULL DEFAULT ''", "paid_until": "TIMESTAMP WITH TIME ZONE",
             "reminded_for": "TIMESTAMP WITH TIME ZONE", "telegram_chat_id": "VARCHAR(32)", "cv_text": "TEXT",
             "ref_code": "VARCHAR(16)", "referred_by": "INTEGER", "ref_rewards": "INTEGER NOT NULL DEFAULT 0",
             "last_run_at": "TIMESTAMP WITH TIME ZONE", "last_run_result": "VARCHAR(200)",
             "confirm_reminded_at": "TIMESTAMP WITH TIME ZONE", "titles_tip_at": "TIMESTAMP WITH TIME ZONE",
             "hours": "VARCHAR(10) NOT NULL DEFAULT 'any'"}
    with engine.begin() as conn:
        for name, sql_type in added.items():
            if name not in have:
                if engine.dialect.name == "sqlite":
                    sql_type = sql_type.replace("TIMESTAMP WITH TIME ZONE", "DATETIME")
                conn.execute(text(f"ALTER TABLE subscribers ADD COLUMN {name} {sql_type}"))
        have_jobs = {c["name"] for c in inspect(engine).get_columns("sent_jobs")}
        for name, sql_type in SENT_JOB_COLUMNS.items():
            if name not in have_jobs:
                if engine.dialect.name == "sqlite":
                    sql_type = sql_type.replace("TIMESTAMP WITH TIME ZONE", "DATETIME")
                conn.execute(text(f"ALTER TABLE sent_jobs ADD COLUMN {name} {sql_type}"))
        if engine.dialect.name == "postgresql":
            # Jobs sent before the tracker stored job details: rebuild them from job_key ("t:<title>|<company>\t<link>"),
            # so they show on the members' area and their Apply links work. Titles come back in Title Case.
            conn.execute(text(r"""UPDATE sent_jobs SET
                  title = initcap(substring(split_part(split_part(job_key, E'\t', 1), '|', 1) from 3)),
                  company = initcap(split_part(split_part(job_key, E'\t', 1), '|', 2)),
                  url = NULLIF(split_part(job_key, E'\t', 2), '')
                WHERE title IS NULL AND job_key LIKE 't:%'"""))
        if "kind" not in {c["name"] for c in inspect(engine).get_columns("letters")}:
            conn.execute(text("ALTER TABLE letters ADD COLUMN kind VARCHAR(10) NOT NULL DEFAULT 'letter'"))
        if "ref_code" not in have:  # create_all only adds the unique index on new databases
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS subscribers_ref_code_key ON subscribers (ref_code)"))


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
        conn.execute(delete(letters).where(letters.c.subscriber_id == row.id))
        conn.execute(delete(logins).where(logins.c.subscriber_id == row.id))
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


def paid_subscriber_ids() -> set[int]:
    """Subscribers who have paid at least once (the trial alone doesn't count)."""
    with engine.begin() as conn:
        return {r[0] for r in conn.execute(select(payments.c.subscriber_id).where(payments.c.subscriber_id.is_not(None)).distinct())}


def is_member(sub: dict, paid_ids: set[int]) -> bool:
    """A paying member with time left: gets the bigger limits and Telegram alerts."""
    return sub["id"] in paid_ids and is_paid(sub)


def start_trial(subscriber_id: int, days: int) -> dict | None:
    """Gives `days` of free alerts to someone who has never had any (trial or paid)."""
    with engine.begin() as conn:
        conn.execute(update(subscribers).where(subscribers.c.id == subscriber_id, subscribers.c.paid_until.is_(None))
                     .values(paid_until=now() + timedelta(days=days)))
        row = conn.execute(select(subscribers).where(subscribers.c.id == subscriber_id)).mappings().first()
        return dict(row) if row else None


def note_run(subscriber_id: int, result: str) -> None:
    """Records what today's search did for this subscriber, for the owner dashboard."""
    with engine.begin() as conn:
        conn.execute(update(subscribers).where(subscribers.c.id == subscriber_id)
                     .values(last_run_at=now(), last_run_result=result[:200]))


def unconfirmed_to_remind() -> list[dict]:
    """Signed up 20 hours to 7 days ago, never confirmed, not reminded yet."""
    t = now()
    with engine.connect() as conn:
        rows = conn.execute(select(subscribers).where(
            subscribers.c.confirmed.is_(False), subscribers.c.confirm_reminded_at.is_(None),
            subscribers.c.created_at <= t - timedelta(hours=20), subscribers.c.created_at >= t - timedelta(days=7)))
        return [dict(r._mapping) for r in rows]


def mark(subscriber_id: int, column: str) -> None:
    """Stamps one of the once-only email columns (confirm_reminded_at, titles_tip_at) with now."""
    with engine.begin() as conn:
        conn.execute(update(subscribers).where(subscribers.c.id == subscriber_id).values({column: now()}))


def mark_reminded(subscriber_id: int, paid_until: datetime) -> None:
    with engine.begin() as conn:
        conn.execute(update(subscribers).where(subscribers.c.id == subscriber_id).values(reminded_for=paid_until))


def already_sent(subscriber_id: int) -> set[str]:
    with engine.begin() as conn:
        return {r.job_key for r in conn.execute(select(sent_jobs.c.job_key).where(sent_jobs.c.subscriber_id == subscriber_id))}


def record_sent(subscriber_id: int, jobs: list[dict]) -> list[int]:
    """Stores today's jobs (each needs "key") and returns their row ids, used in the tracker links."""
    ids = []
    with engine.begin() as conn:
        for j in jobs:
            ids.append(conn.execute(insert(sent_jobs).values(
                subscriber_id=subscriber_id, job_key=j["key"][:500], sent_at=now(), title=(j.get("title") or "")[:300],
                company=(j.get("company") or "")[:200], url=(j.get("url") or "")[:1000], source=(j.get("source") or "")[:60],
                posted_at=j.get("posted"), location=(j.get("location") or "")[:200], pay=(j.get("pay") or "")[:120],
                matched=" · ".join(j.get("matched") or [])[:500],
                description=(j.get("desc") or "")[:DESCRIPTION_MAX] or None).returning(sent_jobs.c.id)).scalar())
        conn.execute(update(subscribers).where(subscribers.c.id == subscriber_id).values(last_sent_at=now()))
    return ids


def trim_descriptions(days: int = 30) -> None:
    """Old adverts are closed by now; dropping their text keeps the database small."""
    with engine.begin() as conn:
        conn.execute(update(sent_jobs).where(sent_jobs.c.sent_at < now() - timedelta(days=days),
                                             sent_jobs.c.description.is_not(None)).values(description=None))


def unsend(ids: list[int]) -> None:
    """Undoes record_sent when the email then failed, so the jobs can go out next time."""
    with engine.begin() as conn:
        conn.execute(delete(sent_jobs).where(sent_jobs.c.id.in_(ids)))


def _fresh(row) -> bool:
    return (_aware(row["posted_at"]) or _aware(row["sent_at"])) >= now() - FRESH


def jobs_to_ask(subscriber_id: int) -> list[dict]:
    """Jobs they opened (or made a CV or letter for) before today, haven't answered about, and are still fresh."""
    start = now().replace(hour=0, minute=0, second=0, microsecond=0)
    with engine.connect() as conn:
        rows = conn.execute(select(sent_jobs).where(
            sent_jobs.c.subscriber_id == subscriber_id, sent_jobs.c.clicked_at.is_not(None), sent_jobs.c.clicked_at < start,
            sent_jobs.c.status.is_(None), sent_jobs.c.asked_count < ASK_MORNINGS).order_by(sent_jobs.c.clicked_at)).mappings()
        return [dict(r) for r in rows if _fresh(r)][:5]


def jobs_waiting(subscriber_id: int) -> list[dict]:
    """Jobs they said "Not yet" to that are still fresh: shown again every morning until they decide."""
    with engine.connect() as conn:
        rows = conn.execute(select(sent_jobs).where(sent_jobs.c.subscriber_id == subscriber_id, sent_jobs.c.status == "not_yet")
                            .order_by(sent_jobs.c.status_at)).mappings()
        return [dict(r) for r in rows if _fresh(r)][:5]


def mark_asked(ids: list[int]) -> None:
    if ids:
        with engine.begin() as conn:
            conn.execute(update(sent_jobs).where(sent_jobs.c.id.in_(ids)).values(asked_count=sent_jobs.c.asked_count + 1))


def set_status(ids: list[int], status: str) -> None:
    if ids:
        with engine.begin() as conn:
            conn.execute(update(sent_jobs).where(sent_jobs.c.id.in_(ids)).values(status=status, status_at=now()))
