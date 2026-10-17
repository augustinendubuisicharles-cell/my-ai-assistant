"""The emails the service sends: sign-up confirmation, manage link, renewal reminder and the daily digest.

Every email is a branded card (logo header, big button, footer) built with tables and inline
styles, which is what Gmail, Outlook and phone mail apps reliably display. Each one also has a
plain-text version. Keep the look in step with job_alerts_worker/src/mail.js.
"""
from html import escape
from urllib.parse import urlencode

FOOTER = "Always read the full listing before applying, and never pay anyone to apply for a job."
BLUE, INK, MUTED, LINE, BG, GOLD, GREEN = "#2457d6", "#1d2433", "#5b6475", "#e3e7ee", "#f3f5f9", "#ffc75a", "#127a3e"
FONT = "font-family:Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"


def _a(url: str) -> str:
    return escape(url, quote=True)


def button(url: str, label: str, color: str = BLUE) -> str:
    return (f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px"><tr>'
            f'<td style="background:{color};border-radius:10px"><a href="{_a(url)}" style="display:inline-block;'
            f'padding:14px 28px;{FONT};font-size:16px;font-weight:700;color:#fff;text-decoration:none">{escape(label)}</a>'
            f"</td></tr></table>")


def layout(base_url: str, preheader: str, hero: str, body: str, footer: str = "") -> str:
    """hero: big headline area on the blue band; body: the white card's contents."""
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:{BG}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">{escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{BG}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="background:{BLUE};background-image:linear-gradient(135deg,#0f1f4d,{BLUE});border-radius:16px 16px 0 0;padding:26px 28px 30px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td><img src="{_a(base_url)}/apple-touch-icon.png" width="40" height="40" alt="" style="display:block;border-radius:10px"></td>
    <td style="padding-left:12px;{FONT};font-size:22px;font-weight:800;color:#fff">Job<span style="color:{GOLD}">Alert</span></td>
  </tr></table>
  <div style="{FONT};color:#fff;margin-top:22px">{hero}</div>
</td></tr>
<tr><td style="background:#fff;border-radius:0 0 16px 16px;padding:26px 28px;{FONT};font-size:15px;line-height:1.55;color:{INK}">
{body}
</td></tr>
<tr><td style="padding:18px 8px;{FONT};font-size:12px;line-height:1.5;color:{MUTED};text-align:center">
{footer or 'You get this because you signed up at <a href="' + _a(base_url) + '" style="color:' + MUTED + '">' + escape(base_url.split("//")[-1]) + '</a>.'}
</td></tr>
</table></td></tr></table></body></html>"""


def _hero(title: str, sub: str = "") -> str:
    return (f'<div style="font-size:26px;line-height:1.25;font-weight:800">{title}</div>'
            + (f'<div style="font-size:15px;opacity:.88;margin-top:8px">{sub}</div>' if sub else ""))


def _steps(steps: list[tuple[str, str, bool]]) -> str:
    """A small vertical timeline: (title, detail, done)."""
    rows = "".join(
        f'<tr><td valign="top" style="padding:0 12px 14px 0"><div style="width:28px;height:28px;border-radius:14px;'
        f'background:{GREEN if done else "#eef3ff"};color:{"#fff" if done else BLUE};text-align:center;line-height:28px;'
        f'font-weight:800;font-size:14px">{"&#10003;" if done else i}</div></td>'
        f'<td valign="top" style="padding-bottom:14px"><b>{escape(t)}</b><br><span style="color:{MUTED};font-size:14px">{escape(d)}</span></td></tr>'
        for i, (t, d, done) in enumerate(steps, 1))
    return f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 4px">{rows}</table>'


def confirmation(base_url: str, token: str) -> tuple[str, str, str]:
    link = f"{base_url}/confirm/{token}"
    text = (f"One click and your jobs are on their way.\n\nConfirm your job alerts here:\n{link}\n\n"
            "If you didn't sign up, ignore this email and nothing more will be sent.")
    body = ("<p style=\"margin:0\">Tap the button to confirm your email. That's the last step. "
            "We'll start searching straight away.</p>" + button(link, "Confirm my job alerts") +
            _steps([("Confirm your email", "One tap, right now", False),
                    ("We search the job boards", "Remote and local jobs, checked for scams and dead links", False),
                    ("Your matches arrive", "Every morning, only jobs that fit you, never repeated", False)]) +
            f'<p style="color:{MUTED};font-size:13px;margin:6px 0 0">If you didn\'t sign up, ignore this email and nothing more will be sent.</p>')
    html = layout(base_url, "One click and your job alerts start.", _hero("Your jobs are on their way 🚀", "Just confirm it's you."), body)
    return "Confirm your job alerts 🚀", text, html


def confirm_reminder(base_url: str, token: str) -> tuple[str, str, str]:
    """Sent once, a day after sign-up, to people who never tapped the confirm link."""
    link = f"{base_url}/confirm/{token}"
    text = (f"You signed up for JobAlert but haven't confirmed your email yet, so we can't send you jobs.\n\n"
            f"Confirm here (one tap):\n{link}\n\nIf you didn't sign up, ignore this email. We won't remind you again.")
    body = ("<p style=\"margin:0\">You signed up for job alerts but haven't confirmed your email yet, "
            "so your matched jobs are waiting. One tap and they start arriving.</p>" + button(link, "Confirm and get my jobs") +
            f'<p style="color:{MUTED};font-size:13px;margin:6px 0 0">If you didn\'t sign up, ignore this email. We won\'t remind you again.</p>')
    html = layout(base_url, "One tap and your matched jobs start arriving.", _hero("Your jobs are waiting ⏳", "Just confirm your email."), body)
    return "Reminder: confirm your email to get your jobs", text, html


def manage_link(base_url: str, token: str) -> tuple[str, str, str]:
    link = f"{base_url}/manage/{token}"
    text = f"You're already signed up. To change your job alerts, open:\n{link}\n\nIf this wasn't you, ignore this email."
    body = ("<p style=\"margin:0\">You're already signed up, so we didn't change anything. "
            "Use this button to change your job titles, location or level.</p>" + button(link, "Change my job alerts") +
            f'<p style="color:{MUTED};font-size:13px;margin:6px 0 0">If this wasn\'t you, ignore this email.</p>')
    return "Change your job alerts", text, layout(base_url, "Your link to change your job alerts.", _hero("You're already in ✅"), body)


def renewal_reminder(base_url: str, token: str, paid_until, price: str, can_pay: bool = True) -> tuple[str, str, str]:
    when = f"{paid_until:%d %b %Y}"
    if not can_pay:  # free trial while paid plans aren't open yet
        text = f"Your free job alerts end on {when}. Paid plans open soon, and we'll email you when you can continue."
        body = (f"<p style=\"margin:0\">Your free trial ends on <b>{when}</b>. Paid plans open soon, and we'll email you "
                "as soon as you can continue. Until then, keep an eye out for your morning matches.</p>")
        return (f"Your free job alerts end on {when}", text,
                layout(base_url, text, _hero("Your trial ends soon ⏳", f"Last day: {when}"), body))
    link = f"{base_url}/pay/{token}"
    text = (f"Your job alerts end on {when}. To keep getting them, renew for {price} here:\n{link}\n\n"
            "Nothing renews automatically, so if you do nothing the emails simply stop.")
    body = (f"<p style=\"margin:0\">Your job alerts stop on <b>{when}</b>. Keep the matches coming for "
            f"<b>{escape(price)}</b>: one payment, no subscription.</p>" + button(link, f"Keep my alerts for {price}") +
            f'<p style="color:{MUTED};font-size:13px;margin:6px 0 0">Nothing renews automatically, so if you do nothing the emails simply stop.</p>')
    return f"Your job alerts end on {when}", text, layout(base_url, text, _hero("Don't miss your next job ⏳", f"Your alerts end on {when}"), body)


def _chip(label: str) -> str:
    good = label.startswith("open to ")
    color, bg = (GREEN, "#e7f6ed") if good else (MUTED, "#f1f3f7")
    return (f'<span style="display:inline-block;margin:6px 6px 0 0;padding:3px 10px;border-radius:20px;background:{bg};'
            f'color:{color};font-size:12px;font-weight:600">{"✓ " if good else ""}{escape(label)}</span>')


def _job_card(j: dict, letter_url: str = "", cv_url: str = "", apply_url: str = "", extra: str = "") -> str:
    """apply_url: members' Apply link goes through the site first (it tells us they opened it);
    extra: more links on the same row (the "Applied" / "Not for me" answers on jobs shown again)."""
    apply_url = apply_url or j["url"]
    source = f' · via {escape(j["source"])}' if j.get("source") else ""
    company = f'<div style="color:{MUTED};font-size:14px;margin-top:2px">{escape(j["company"])}{source}</div>' \
        if j["company"] else (f'<div style="color:{MUTED};font-size:14px;margin-top:2px">{source[3:]}</div>' if source else "")
    return (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;border:1px solid {LINE};'
            f'border-radius:12px"><tr><td style="padding:16px 18px">'
            f'<a href="{_a(apply_url)}" style="color:{INK};text-decoration:none;font-size:17px;font-weight:700">{escape(j["title"])}</a>'
            f'{company}<div>{"".join(_chip(m) for m in j.get("matched", []))}</div>'
            f'<div style="margin-top:12px"><a href="{_a(apply_url)}" style="color:{BLUE};font-weight:700;text-decoration:none">'
            f"View and apply &rarr;</a>"
            + (f'<a href="{_a(cv_url)}" style="color:{MUTED};font-weight:600;text-decoration:none;margin-left:16px">'
               f"📄 Tailored CV</a>" if cv_url else "")
            + (f'<a href="{_a(letter_url)}" style="color:{MUTED};font-weight:600;text-decoration:none;margin-left:16px">'
               f"✍️ Cover letter</a>" if letter_url else "")
            + extra + "</div></td></tr></table>")


def _last_day_box(trial: dict, pay: str, n: int) -> str:
    """The trial's last morning: what membership would add to today's jobs, the price and the places left."""
    places = trial.get("places_left") or 0
    jobs = f"these {n} jobs" if n != 1 else "this job"
    return (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 16px"><tr>'
            f'<td style="background:#fff6e0;border:2px solid {GOLD};border-radius:12px;padding:18px">'
            f'<div style="font-size:18px;font-weight:800">⏳ Your free trial ends today</div>'
            f'<div style="margin-top:8px;font-size:14px">Members would get for {jobs}:</div>'
            f'<div style="margin-top:6px;font-size:14px;line-height:1.7">📄 A CV tailored to each one<br>✍️ A cover letter for each one<br>'
            f'⭐ The 5 best jobs every morning, and more whenever you ask</div>'
            + (f'<div style="margin-top:12px"><a href="{_a(pay)}" style="display:inline-block;background:{BLUE};color:#fff;font-weight:700;'
               f'text-decoration:none;padding:12px 20px;border-radius:8px">Keep my jobs for {escape(trial["price"])}</a></div>'
               if trial.get("can_pay") else "")
            + (f'<div style="margin-top:8px;color:{MUTED};font-size:13px">Launch price: {places} place{"s" if places != 1 else ""} left</div>'
               if places and trial.get("can_pay") else "")
            + "</td></tr></table>")


def _trial_box(trial: dict, pay: str) -> str:
    """Countdown for free-trial users plus, in one line, what members get."""
    days = trial["days_left"]
    left = "Last day of your free trial" if days <= 1 else f"{days} days left in your free trial"
    action = (f'<div style="margin-top:12px"><a href="{_a(pay)}" style="display:inline-block;background:{BLUE};color:#fff;'
              f'font-weight:700;text-decoration:none;padding:10px 18px;border-radius:8px">Join for {escape(trial["price"])}</a></div>'
              if trial.get("can_pay") else f'<div style="margin-top:8px;color:{MUTED};font-size:13px">Membership opens soon. We\'ll email you.</div>')
    return (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 16px"><tr>'
            f'<td style="background:#eef3ff;border-radius:12px;padding:16px 18px">'
            f'<div style="font-size:16px;font-weight:800">⏳ {left}</div>'
            f'<div style="margin-top:6px;font-size:14px;color:{INK}">Members get <b>{escape(trial["perks"])}</b>.</div>'
            f"{action}</td></tr></table>")


def letter_link(base_url: str, token: str, j: dict, kind: str = "letter") -> str:
    """The member's cover-letter page (kind "letter") or tailored-CV page (kind "cv") for one job."""
    return f"{base_url}/{kind}/{token}?" + urlencode({"t": j["title"], "c": j["company"], "u": j["url"]})


def job_link(base_url: str, token: str, job_id: int) -> str:
    """The job's own page on the site: the whole advert, how to apply, then one button to the employer's form."""
    return f"{base_url}/j/{token}/{job_id}"


def go_link(base_url: str, token: str, job_id: int) -> str:
    """Members' Apply link: notes that they opened the job, then forwards to the advert."""
    return f"{base_url}/go/{token}/{job_id}"


def answer_link(base_url: str, token: str, job_id: int, answer: str) -> str:
    """One tap on "Applied", "Not yet" or "Not for me" (db.STATUSES)."""
    return f"{base_url}/job/{token}/{job_id}/{answer}"


def _pill(url: str, label: str, color: str, bg: str) -> str:
    return (f'<a href="{_a(url)}" style="display:inline-block;margin:8px 6px 0 0;padding:7px 14px;border-radius:20px;background:{bg};'
            f'color:{color};font-size:13px;font-weight:700;text-decoration:none">{label}</a>')


def _ask_box(ask: list[dict], base_url: str, token: str) -> str:
    """"Did you apply?" for jobs they opened yesterday or before, with three one-tap answers."""
    rows = "".join(
        f'<div style="padding:12px 0;border-top:1px solid #dbe4fb"><b>{escape(j["title"])}</b>'
        + (f'<span style="color:{MUTED}"> · {escape(j["company"])}</span>' if j.get("company") else "") + "<br>"
        + _pill(answer_link(base_url, token, j["id"], "applied"), "✅ Applied", "#fff", GREEN)
        + _pill(answer_link(base_url, token, j["id"], "not_yet"), "⏳ Not yet", BLUE, "#fff")
        + _pill(answer_link(base_url, token, j["id"], "skip"), "✕ Not for me", MUTED, "#fff") + "</div>"
        for j in ask)
    return (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr>'
            f'<td style="background:#eef3ff;border-radius:12px;padding:16px 18px 6px">'
            f'<div style="font-size:16px;font-weight:800;margin-bottom:10px">Did you apply? 🤔</div>{rows}</td></tr></table>')


def _heading(text: str) -> str:
    return f'<div style="font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:{MUTED};margin:6px 0 10px">{text}</div>'


def digest(jobs: list[dict], today, base_url: str, token: str, trial: dict | None = None,
           first: bool = False, letters: bool = False, ask: list[dict] | None = None,
           waiting: list[dict] | None = None, tracker: bool = False) -> tuple[str, str, str]:
    """`trial`: for free-trial users, {"days_left", "perks", "price", "can_pay"} adds a short countdown box.
    `first`: the email sent right after someone confirms. `letters`: members get a tailored-CV and a cover-letter link per job.
    Every job with its sent_jobs "id" links to its page on the site. `tracker` (members): the email can open with `ask` ("Did you apply?")
    and `waiting` (jobs they said "Not yet" to). Tracked jobs need their sent_jobs "id"."""
    manage, unsub, pay = f"{base_url}/manage/{token}", f"{base_url}/unsubscribe/{token}", f"{base_url}/pay/{token}"
    apps = f"{base_url}/applications/{token}"
    ask, waiting = (ask or [], waiting or []) if tracker else ([], [])
    apply = lambda j: job_link(base_url, token, j["id"]) if j.get("id") else j["url"]
    n = len(jobs)
    lines = [f"Your first job matches" if first else f"Your job matches -- {today:%a %d %b}", ""]
    if ask:
        lines += ["Did you apply?"]
        for j in ask:
            lines += [f"- {j['title']}" + (f" at {j['company']}" if j.get("company") else ""),
                      f"  Applied: {answer_link(base_url, token, j['id'], 'applied')}",
                      f"  Not yet: {answer_link(base_url, token, j['id'], 'not_yet')}",
                      f"  Not for me: {answer_link(base_url, token, j['id'], 'skip')}"]
        lines += [""]
    if waiting:
        lines += ["Still waiting for you:"]
        for j in waiting:
            lines += [f"- {j['title']}" + (f" at {j['company']}" if j.get("company") else ""), f"  {apply(j)}",
                      f"  Applied: {answer_link(base_url, token, j['id'], 'applied')}"]
        lines += ["", "New today:" if jobs else ""]
    for i, j in enumerate(jobs, 1):
        company = f" at {j['company']}" if j["company"] else ""
        lines += [f"{i}. {j['title']}{company}", f"   {apply(j)}"]
        if letters:
            lines += [f"   Tailored CV: {letter_link(base_url, token, j, 'cv')}", f"   Cover letter: {letter_link(base_url, token, j)}"]
        lines += [""]
    if trial and trial["days_left"] <= 1:
        lines += [f"Your free trial ends today. Members would get a tailored CV and a cover letter for each of these jobs, "
                  f"and {trial['perks']}." + (f" Keep your jobs for {trial['price']}: {pay}" if trial.get("can_pay") else ""), ""]
    elif trial:
        lines += [f"{trial['days_left']} day(s) left in your free trial. Members get {trial['perks']}."
                  + (f" Become a member: {pay}" if trial.get("can_pay") else " Membership opens soon."), ""]
    lines += [FOOTER, "", f"Log in: {base_url}/login/{token}", ""] + ([f"My applications: {apps}"] if tracker else []) + [f"Change what you get: {manage}", f"Unsubscribe: {unsub}"]

    def card(j: dict, extra: str = "") -> str:
        links = (letter_link(base_url, token, j), letter_link(base_url, token, j, "cv")) if letters else ("", "")
        return _job_card(j, *links, apply_url=apply(j), extra=extra)

    def answers(j: dict) -> str:
        return (f'<br><a href="{_a(answer_link(base_url, token, j["id"], "applied"))}" style="display:inline-block;margin-top:10px;color:{GREEN};'
                f'font-weight:700;text-decoration:none">✅ I applied</a><a href="{_a(answer_link(base_url, token, j["id"], "skip"))}" '
                f'style="display:inline-block;margin:10px 0 0 16px;color:{MUTED};font-weight:600;text-decoration:none">✕ Not for me</a>')

    body = _ask_box(ask, base_url, token) if ask else ""
    if waiting:
        body += _heading("Still waiting for you") + "".join(card(j, answers(j)) for j in waiting)
        body += _heading("New today") if jobs else ""
    last_day = bool(trial) and trial["days_left"] <= 1
    body += "".join(card(j) for j in jobs) + ((_last_day_box(trial, pay, n) if last_day else _trial_box(trial, pay)) if trial else "")
    body += f'<p style="color:{MUTED};font-size:13px;margin:6px 0 0">💡 Apply early. {escape(FOOTER)}</p>'
    body += button(f"{base_url}/login/{token}", "Log in")
    footer = ((f'<a href="{_a(apps)}" style="color:{MUTED}">📋 My applications</a> &middot; ' if tracker else "")
              + f'<a href="{_a(manage)}" style="color:{MUTED}">🎁 Invite 2 friends, get a month free</a><br>'
              f'<a href="{_a(manage)}" style="color:{MUTED}">Change what you get</a> &middot; '
              f'<a href="{_a(unsub)}" style="color:{MUTED}">Unsubscribe</a>')
    jobs_word = f"{n} job{'s' if n != 1 else ''}"
    hero = (_hero(f"Your first {jobs_word} are here 🎉" if n != 1 else "Your first job is here 🎉", "More every morning, never repeated")
            if first else _hero(f"{n} new job{'s' if n != 1 else ''} for you ☀️", f"{today:%A %d %B}"))
    html = layout(base_url, f"{jobs[0]['title']} and more, picked for you." if jobs else "", hero, body, footer)
    subject = ((f"🎉 Your first {jobs_word} from JobAlert" if n != 1 else "🎉 Your first job from JobAlert") if first
               else f"☀️ {n} new job match{'es' if n != 1 else ''} for you -- {today:%d %b}")
    return subject, "\n".join(lines), html


def no_matches_yet(base_url: str, token: str, keywords: str) -> tuple[str, str, str]:
    """Sent instead of the first digest when nothing matched, so a new subscriber isn't left wondering."""
    manage = f"{base_url}/manage/{token}"
    text = (f"We searched for {keywords} and found nothing new that fits today. We'll keep looking every morning.\n\n"
            f"Tip: broader job titles find more jobs. Change yours here: {manage}")
    body = (f"<p style=\"margin:0\">We searched for <b>{escape(keywords)}</b> and found nothing that fits yet. "
            "We'll keep looking every morning.</p>"
            f'<p style="margin:14px 0 0;color:{MUTED};font-size:14px">💡 Broader or common job titles find more jobs.</p>'
            + button(manage, "Change my job titles"))
    return "We're searching for your jobs 🔎", text, layout(base_url, "Nothing yet, we'll keep looking every morning.",
                                                           _hero("We're on it 🔎", "No matches yet"), body)


def win_back(base_url: str, token: str, jobs: list[dict], price: str, can_pay: bool, places_left: int = 0,
             second: bool = False) -> tuple[str, str, str]:
    """After the free trial ends: a few of today's jobs they're missing (titles only; opening one goes to the pay page),
    the price and the launch places left. Sent 1 day and 4 days after the trial ends."""
    pay, unsub = f"{base_url}/pay/{token}", f"{base_url}/unsubscribe/{token}"
    n = len(jobs)
    head = (f"{n} new job{'s' if n != 1 else ''} matched you today" if n else "New jobs are still coming in")
    subject = ("Last chance: your jobs are waiting 👀" if second else "We miss you 👋 Your jobs are still coming in")
    places = f"Launch price: {places_left} place{'s' if places_left != 1 else ''} left." if places_left and can_pay else ""
    lines = [head + ", but your free trial has ended.", ""]
    lines += [f"- {j['title']}" + (f" at {j['company']}" if j.get("company") else "") for j in jobs]
    lines += ["", f"Get them back, with a tailored CV and cover letter for each, for {price}: {pay}" if can_pay else
              "Paid plans open soon. We'll email you when you can continue.", places, "", f"Unsubscribe: {unsub}"]
    rows = "".join(
        f'<tr><td style="padding:12px 14px;border:1px solid {LINE};border-radius:10px;background:#fff">'
        f'<a href="{_a(pay)}" style="color:{INK};text-decoration:none;font-weight:700">{escape(j["title"])}</a>'
        + (f'<div style="color:{MUTED};font-size:13px">{escape(j["company"])}</div>' if j.get("company") else "")
        + '</td></tr><tr><td style="height:8px"></td></tr>' for j in jobs)
    body = (f'<p style="margin:0 0 14px">{"Your free trial has ended, but the jobs haven't stopped." if not second else "Your jobs are still waiting for you."} '
            f'Here {"are" if n != 1 else "is"} {"some of " if n > 1 else ""}today\'s:</p>' if n else
            '<p style="margin:0 0 14px">Your free trial has ended, but new jobs that fit you arrive every morning.</p>')
    body += f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows}</table>' if rows else ""
    body += ((button(pay, f"Get my jobs back for {price}", BLUE)
              + f'<p style="color:{MUTED};font-size:13px;margin:6px 0 0">A tailored CV and cover letter for each job. '
              f'Pay once, nothing renews automatically.{(" " + escape(places)) if places else ""}</p>') if can_pay else
             f'<p style="color:{MUTED};font-size:14px">Paid plans open soon. We\'ll email you when you can continue.</p>')
    footer = f'<a href="{_a(unsub)}" style="color:{MUTED}">Unsubscribe</a>'
    return subject, "\n".join(l for l in lines if l is not None), layout(base_url, head, _hero(head + " 👀" if n else "We miss you 👋",
                                                                 "Your free trial has ended"), body, footer)


def more_titles(base_url: str, token: str, titles: list[str]) -> tuple[str, str, str]:
    """One-off news email (17 Oct 2026): sign-up now asks for 5 job titles, so we ask earlier sign-ups to add more."""
    manage = f"{base_url}/manage/{token}"
    n = min(len(titles), 5)
    dots = "".join(f'<span style="display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:6px;'
                   f'background:{BLUE if k < n else "#dbe3f3"}"></span>' for k in range(5))
    chips = "".join(f'<span style="display:inline-block;margin:0 6px 6px 0;padding:6px 12px;border-radius:20px;'
                    f'background:#eef3ff;color:{BLUE};font-size:14px;font-weight:700">{escape(t)}</span>' for t in titles)
    body = (f'<p style="margin:0 0 16px">More job titles means more matches. You now pick <b>5</b>, '
            "and we suggest similar ones as you go.</p>"
            f'<div style="margin:0 0 6px">{dots}<b style="font-size:14px">{n} of 5 picked</b></div>'
            f'<div style="margin:10px 0 0">{chips}</div>'
            + button(manage, "Add my job titles")
            + f'<p style="color:{MUTED};font-size:13px;margin:6px 0 0">Add them today and tomorrow morning\'s email '
              "searches all of them.</p>")
    text = (f"More job titles means more matches. You can now pick 5, and we suggest similar ones as you go.\n\n"
            f"You've picked {n} of 5: {', '.join(titles)}\n\n"
            f"Add yours today and tomorrow morning's email searches all of them:\n{manage}")
    html = layout(base_url, "Pick 5 job titles and get more matches tomorrow.", _hero("Pick 5 jobs, get more matches 🎯",
                  "A quick update to your job alerts."), body)
    return "Add more job titles for more matches tomorrow 🎯", text, html
