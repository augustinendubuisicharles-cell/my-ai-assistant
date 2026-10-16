"""Read-only: subscriber 42's address, for a one-person resend."""
from sqlalchemy import text
from job_alerts.db import engine
with engine.connect() as c:
    print("EMAIL42:", c.execute(text("select email from subscribers where id=42")).scalar())
