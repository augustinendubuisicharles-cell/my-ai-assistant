// Sends email through Brevo's web API (Workers can't open SMTP connections).
// The confirmation and manage-link emails match job_alerts/emails.py (same branded layout:
// tables and inline styles, which is what mail apps reliably display).
import { esc } from "./views.js";

export async function send(env, to, subject, text, html) {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": (env.BREVO_API_KEY || "").trim(), "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: env.FROM_NAME || "JobAlert", email: (env.FROM_EMAIL || "").trim() },
      to: [{ email: to }], subject, htmlContent: html, textContent: text,
    }),
  });
  if (r.status >= 300) throw new Error(`Brevo API ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

const BLUE = "#2457d6", INK = "#1d2433", MUTED = "#5b6475", BG = "#f3f5f9", GOLD = "#ffc75a";
const FONT = "font-family:Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const button = (url, label) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px"><tr>` +
  `<td style="background:${BLUE};border-radius:10px"><a href="${esc(url)}" style="display:inline-block;` +
  `padding:14px 28px;${FONT};font-size:16px;font-weight:700;color:#fff;text-decoration:none">${esc(label)}</a></td></tr></table>`;

const hero = (title, sub = "") =>
  `<div style="font-size:26px;line-height:1.25;font-weight:800">${title}</div>` +
  (sub ? `<div style="font-size:15px;opacity:.88;margin-top:8px">${sub}</div>` : "");

function steps(list) {
  const rows = list.map(([t, d], i) =>
    `<tr><td valign="top" style="padding:0 12px 14px 0"><div style="width:28px;height:28px;border-radius:14px;` +
    `background:#eef3ff;color:${BLUE};text-align:center;line-height:28px;font-weight:800;font-size:14px">${i + 1}</div></td>` +
    `<td valign="top" style="padding-bottom:14px"><b>${esc(t)}</b><br><span style="color:${MUTED};font-size:14px">${esc(d)}</span></td></tr>`).join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 4px">${rows}</table>`;
}

export function layout(baseUrl, preheader, heroHtml, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:${BG}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="background:${BLUE};background-image:linear-gradient(135deg,#0f1f4d,${BLUE});border-radius:16px 16px 0 0;padding:26px 28px 30px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td><img src="${esc(baseUrl)}/apple-touch-icon.png" width="40" height="40" alt="" style="display:block;border-radius:10px"></td>
    <td style="padding-left:12px;${FONT};font-size:22px;font-weight:800;color:#fff">Job<span style="color:${GOLD}">Alert</span></td>
  </tr></table>
  <div style="${FONT};color:#fff;margin-top:22px">${heroHtml}</div>
</td></tr>
<tr><td style="background:#fff;border-radius:0 0 16px 16px;padding:26px 28px;${FONT};font-size:15px;line-height:1.55;color:${INK}">
${body}
</td></tr>
<tr><td style="padding:18px 8px;${FONT};font-size:12px;line-height:1.5;color:${MUTED};text-align:center">
You get this because you signed up at <a href="${esc(baseUrl)}" style="color:${MUTED}">${esc(baseUrl.split("//").pop())}</a>.
</td></tr>
</table></td></tr></table></body></html>`;
}

export function confirmation(baseUrl, token) {
  const link = `${baseUrl}/confirm/${token}`;
  const body = `<p style="margin:0">Tap the button to confirm your email. That's the last step. We'll start searching straight away.</p>` +
    button(link, "Confirm my job alerts") +
    steps([["Confirm your email", "One tap, right now"],
      ["We search the job boards", "Remote and local jobs, checked for scams and dead links"],
      ["Your matches arrive", "Every morning, only jobs that fit you, never repeated"]]) +
    `<p style="color:${MUTED};font-size:13px;margin:6px 0 0">If you didn't sign up, ignore this email and nothing more will be sent.</p>`;
  return ["Confirm your job alerts 🚀",
    `One click and your jobs are on their way.\n\nConfirm your job alerts here:\n${link}\n\nIf you didn't sign up, ignore this email and nothing more will be sent.`,
    layout(baseUrl, "One click and your job alerts start.", hero("Your jobs are on their way 🚀", "Just confirm it's you."), body)];
}

export function manageLink(baseUrl, token) {
  const link = `${baseUrl}/manage/${token}`;
  const body = `<p style="margin:0">You're already signed up, so we didn't change anything. Use this button to change your job titles, location or level.</p>` +
    button(link, "Change my job alerts") +
    `<p style="color:${MUTED};font-size:13px;margin:6px 0 0">If this wasn't you, ignore this email.</p>`;
  return ["Change your job alerts",
    `You're already signed up. To change your job alerts, open:\n${link}\n\nIf this wasn't you, ignore this email.`,
    layout(baseUrl, "Your link to change your job alerts.", hero("You're already in ✅"), body)];
}

// Sent to someone whose invited friends just earned them free time.
export function referralReward(baseUrl, token, months, until) {
  const link = `${baseUrl}/manage/${token}`;
  const what = months === 1 ? "a free month" : `${months} free months`;
  const body = `<p style="margin:0">Two friends you invited joined JobAlert, so you get <b>${what}</b> of job alerts. ` +
    `Your alerts now run until <b>${esc(until)}</b>.</p>` + button(link, "Invite more friends") +
    `<p style="color:${MUTED};font-size:13px;margin:6px 0 0">Every 2 friends who join = another free month.</p>`;
  return [`🎁 You earned ${what} of JobAlert`,
    `Two friends you invited joined JobAlert, so you get ${what}. Your alerts now run until ${until}.\n\nInvite more: ${link}`,
    layout(baseUrl, `Your alerts now run until ${until}.`, hero(`You earned ${what} 🎁`, "Thanks for spreading the word"), body)];
}
