// Sends email through Brevo's web API (Workers can't open SMTP connections).
// The confirmation and manage-link emails match job_alerts/emails.py.
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

export function confirmation(baseUrl, token) {
  const link = `${baseUrl}/confirm/${token}`;
  return ["Confirm your job alerts",
    `Please confirm your job alerts by opening this link:\n${link}\n\nIf you didn't sign up, ignore this email.`,
    `<p>Please confirm your job alerts:</p><p><a href="${esc(link)}"><b>Confirm my job alerts</b></a></p>` +
    `<p style="color:#666">If you didn't sign up, ignore this email and nothing more will be sent.</p>`];
}

export function manageLink(baseUrl, token) {
  const link = `${baseUrl}/manage/${token}`;
  return ["Change your job alerts",
    `You're already signed up. To change your job alerts, open:\n${link}\n\nIf this wasn't you, ignore this email.`,
    `<p>You're already signed up. To change your job alerts:</p><p><a href="${esc(link)}"><b>Change my job alerts</b></a></p>` +
    `<p style="color:#666">If this wasn't you, ignore this email.</p>`];
}
