"""Emails the daily job digest -- works with any inbox, no extra app needed.

Defaults to Gmail (smtp.gmail.com:465). Use a Gmail *app password*, not your
normal password: https://myaccount.google.com/apppasswords
"""
import smtplib
from email.message import EmailMessage
from html import escape


def format_text(jobs: list[dict], today, heading: str = "Your top opportunities") -> str:
    """Plain-text fallback for mail clients that don't show HTML."""
    lines = [f"{heading} -- {today:%a %d %b}", ""]
    if not jobs:
        lines.append("No listings passed all the checks this time.")
    for i, j in enumerate(jobs, 1):
        company = f" at {j['company']}" if j["company"] else ""
        where = f" -- {j['location']}" if j["location"] else ""
        lines += [f"{i}. {j['title']}{company}{where}", f"   {', '.join(j['matched']) or 'keyword match'} (via {j['source']})", f"   {j['url']}", ""]
    lines.append("Always read the full listing before applying, and never pay anyone to apply for a job.")
    return "\n".join(lines)


def format_html(jobs: list[dict], today, heading: str = "Your top opportunities") -> str:
    """The same digest as the Telegram message, laid out for an email client."""
    if not jobs:
        body = "<p>No listings passed all the checks this time.</p>"
    else:
        items = []
        for j in jobs:
            company = f" at <b>{escape(j['company'])}</b>" if j["company"] else ""
            where = f" &middot; {escape(j['location'])}" if j["location"] else ""
            why = escape(", ".join(j["matched"]) or "keyword match")
            items.append(
                f'<li style="margin-bottom:14px"><a href="{escape(j["url"], quote=True)}"><b>{escape(j["title"])}</b></a>'
                f"{company}{where}<br><i>{why}</i> (via {escape(j['source'])})</li>"
            )
        body = "<ol>" + "".join(items) + "</ol>"
    return (
        f"<h2>{escape(heading)} &mdash; {today:%a %d %b}</h2>{body}"
        "<p><i>Always read the full listing before applying, and never pay anyone to apply for a job.</i></p>"
    )


def send_email(
    user: str, password: str, to: str, subject: str, text: str, html: str,
    host: str = "smtp.gmail.com", port: int = 465,
) -> None:
    """Sends one email with a plain-text fallback and an HTML version. `to` may be comma-separated."""
    msg = EmailMessage()
    msg["From"] = user
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    with smtplib.SMTP_SSL(host, port, timeout=30) as smtp:
        smtp.login(user, password)
        smtp.send_message(msg)
