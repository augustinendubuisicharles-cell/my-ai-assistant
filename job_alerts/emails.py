"""The emails the service sends: sign-up confirmation, manage link, renewal reminder and the daily digest."""
from html import escape

FOOTER = "Always read the full listing before applying, and never pay anyone to apply for a job."


def confirmation(base_url: str, token: str) -> tuple[str, str, str]:
    link = f"{base_url}/confirm/{token}"
    text = f"Please confirm your job alerts by opening this link:\n{link}\n\nIf you didn't sign up, ignore this email."
    html = (f"<p>Please confirm your job alerts:</p><p><a href=\"{escape(link, quote=True)}\"><b>Confirm my job alerts</b></a></p>"
            "<p style=\"color:#666\">If you didn't sign up, ignore this email and nothing more will be sent.</p>")
    return "Confirm your job alerts", text, html


def manage_link(base_url: str, token: str) -> tuple[str, str, str]:
    link = f"{base_url}/manage/{token}"
    text = f"You're already signed up. To change your job alerts, open:\n{link}\n\nIf this wasn't you, ignore this email."
    html = (f"<p>You're already signed up. To change your job alerts:</p><p><a href=\"{escape(link, quote=True)}\">"
            "<b>Change my job alerts</b></a></p><p style=\"color:#666\">If this wasn't you, ignore this email.</p>")
    return "Change your job alerts", text, html


def renewal_reminder(base_url: str, token: str, paid_until, price: str) -> tuple[str, str, str]:
    link = f"{base_url}/pay/{token}"
    when = f"{paid_until:%d %b %Y}"
    text = (f"Your job alerts end on {when}. To keep getting them, renew for {price} here:\n{link}\n\n"
            "Nothing renews automatically, so if you do nothing the emails simply stop.")
    html = (f"<p>Your job alerts end on <b>{when}</b>.</p><p><a href=\"{escape(link, quote=True)}\"><b>Renew for {escape(price)}</b></a></p>"
            "<p style=\"color:#666\">Nothing renews automatically, so if you do nothing the emails simply stop.</p>")
    return f"Your job alerts end on {when}", text, html


def digest(jobs: list[dict], today, base_url: str, token: str) -> tuple[str, str, str]:
    manage, unsub = f"{base_url}/manage/{token}", f"{base_url}/unsubscribe/{token}"
    lines = [f"Your job matches -- {today:%a %d %b}", ""]
    items = []
    for i, j in enumerate(jobs, 1):
        company = f" at {j['company']}" if j["company"] else ""
        lines += [f"{i}. {j['title']}{company}", f"   {', '.join(j['matched'])} (via {j['source']})", f"   {j['url']}", ""]
        items.append(
            f'<li style="margin-bottom:14px"><a href="{escape(j["url"], quote=True)}"><b>{escape(j["title"])}</b></a>'
            f"{' at <b>' + escape(j['company']) + '</b>' if j['company'] else ''}"
            f"<br><i>{escape(', '.join(j['matched']))}</i> (via {escape(j['source'])})</li>")
    lines += [FOOTER, "", f"Change what you get: {manage}", f"Unsubscribe: {unsub}"]
    html = (f"<h2>Your job matches &mdash; {today:%a %d %b}</h2><ol>{''.join(items)}</ol><p><i>{FOOTER}</i></p>"
            f'<p style="color:#666;font-size:13px"><a href="{escape(manage, quote=True)}">Change what you get</a> &middot; '
            f'<a href="{escape(unsub, quote=True)}">Unsubscribe</a></p>')
    return f"{len(jobs)} new job match{'es' if len(jobs) != 1 else ''} for you -- {today:%d %b}", "\n".join(lines), html
