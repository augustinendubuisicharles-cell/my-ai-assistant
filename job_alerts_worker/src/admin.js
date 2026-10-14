// The owner's private dashboard at /admin (password = ADMIN_KEY, remembered in a cookie)
// or straight from /admin/<ADMIN_KEY>: every subscriber, whether this
// morning's job search reached them (send_daily.py records last_run_at/last_run_result),
// and a one-line verdict on the system's health. Without ADMIN_KEY the page doesn't exist.
import { esc } from "./views.js";
import * as payments from "./payments.js";
import * as telegram from "./telegram.js";
import * as firstSearch from "./firstsearch.js";
import * as letters from "./letters.js";

const MIN_KEY = 16;

const COOKIE = "ja_admin";
const adminKey = (env) => (env.ADMIN_KEY || "").trim();
export const enabled = (env) => adminKey(env).length >= MIN_KEY;
const digest = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

async function same(x, y) {
  const [a, b] = await Promise.all([digest(x), digest(y)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Compares a typed or linked password with ADMIN_KEY without leaking how much matched.
export async function allowed(env, given) {
  given = String(given || "").trim();
  return enabled(env) && Boolean(given) && same(adminKey(env), given);
}

// After logging in, the browser keeps a cookie derived from the key (not the key itself),
// so changing JOB_ALERTS_ADMIN_KEY logs everyone out.
const sessionValue = async (env) => hex(await digest(`jobalert-admin-session:${adminKey(env)}`));

export async function loggedIn(env, request) {
  if (!enabled(env)) return false;
  const m = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9a-f]{64})`));
  return Boolean(m) && same(await sessionValue(env), m[1]);
}

export const sessionCookie = async (env) =>
  `${COOKIE}=${await sessionValue(env)}; Path=/admin; Max-Age=${60 * 60 * 24 * 30}; HttpOnly; Secure; SameSite=Strict`;

export function loginPage(siteName, wrong = false) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<title>${esc(siteName)} dashboard</title><style>${STYLE}
  form { display:grid; gap:10px; } input, button { font:inherit; padding:10px 12px; border-radius:8px; border:1px solid var(--border); }
  input { background:var(--bg); color:var(--text); } button { background:var(--accent); color:#fff; border:0; font-weight:600; cursor:pointer; }
</style></head>
<body><main style="max-width:420px">
<h1>${esc(siteName)} dashboard</h1>
<div class="card" style="margin-top:12px"><form method="post" action="/admin">
<label for="key">Password</label>
<input id="key" name="key" type="password" autocomplete="current-password" required autofocus>
${wrong ? `<span class="bad small">That password doesn't match. Paste it again exactly as saved in GitHub.</span>` : ""}
<button type="submit">Open dashboard</button></form></div>
<p class="muted small">This browser stays logged in for 30 days.</p>
</main></body></html>`;
}

// The morning run starts at 06:00 UTC (07:00 in Nigeria). Until 06:30 UTC we judge
// yesterday's run, so the page isn't red every morning before the run has finished.
export function runWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 5));
  const due = new Date(start.getTime() + 90 * 60 * 1000);
  if (now < due) start.setUTCDate(start.getUTCDate() - 1);
  return start;
}

async function recentRuns(env) {
  if (!firstSearch.enabled(env)) return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO.trim()}/actions/workflows/job_alerts_daily.yml/runs?per_page=6`, {
      headers: { authorization: `Bearer ${env.GH_TOKEN.trim()}`, accept: "application/vnd.github+json", "user-agent": "jobalert-worker" },
    });
    if (!r.ok) return null;
    return ((await r.json()).workflow_runs || []).map((w) => ({
      when: new Date(w.run_started_at || w.created_at), status: w.status, conclusion: w.conclusion,
      event: w.event, url: w.html_url, title: w.display_title || "",
    }));
  } catch {
    return null;
  }
}

export async function load(env, q, now = new Date()) {
  const since = runWindow(now);
  const [users, money, runs] = await Promise.all([
    q(`SELECT s.id, s.email, s.keywords, s.country, s.remote_only, s.city, s.confirmed, s.created_at, s.paid_until,
              s.last_run_at, s.last_run_result, s.telegram_chat_id IS NOT NULL AS telegram,
              (SELECT count(*) FROM sent_jobs j WHERE j.subscriber_id = s.id)::int AS jobs_sent,
              (SELECT max(j.sent_at) FROM sent_jobs j WHERE j.subscriber_id = s.id) AS last_job_at,
              EXISTS (SELECT 1 FROM payments p WHERE p.subscriber_id = s.id) AS member
         FROM subscribers s ORDER BY s.created_at DESC`),
    q(`SELECT coalesce(sum(amount_ngn), 0)::int AS total,
              coalesce(sum(amount_ngn) FILTER (WHERE paid_at > now() - interval '30 days'), 0)::int AS month,
              count(*) FILTER (WHERE amount_ngn > 0)::int AS paid_count
         FROM payments`),
    recentRuns(env),
  ]);
  for (const u of users) {
    const active = u.paid_until && new Date(u.paid_until) > now;
    u.status = !u.confirmed ? "unconfirmed" : !active ? "expired" : u.member ? "member" : "trial";
    u.ranToday = Boolean(u.last_run_at && new Date(u.last_run_at) >= since);
    u.failed = u.ranToday && /^FAILED/.test(u.last_run_result || "");
  }
  const confirmed = users.filter((u) => u.confirmed);
  const active = confirmed.filter((u) => u.status === "member" || u.status === "trial");
  const count = (s) => users.filter((u) => u.status === s).length;
  const today = active.filter((u) => u.ranToday);
  const services = [
    ["Email (Brevo)", Boolean((env.BREVO_API_KEY || "").trim() && (env.FROM_EMAIL || "").trim())],
    [`Payments${payments.provider(env) ? ` (${payments.provider(env)})` : ""}`, Boolean(payments.provider(env))],
    ["On-time morning run and first search (GitHub token)", firstSearch.enabled(env)],
    ["Cover letters (Claude)", letters.enabled(env)],
    ["Telegram", telegram.enabled(env)],
  ];
  const lastRun = runs?.find((r) => r.status === "completed");
  const stats = {
    since, users: users.length, confirmed: confirmed.length, active: active.length,
    member: count("member"), trial: count("trial"), expired: count("expired"), unconfirmed: count("unconfirmed"),
    reached: today.length, sent: today.filter((u) => /^sent/.test(u.last_run_result || "")).length,
    none: today.filter((u) => /^no new/.test(u.last_run_result || "")).length,
    failed: today.filter((u) => u.failed).length, missed: active.length - today.length,
    revenue: money[0], runs, lastRun, services,
  };
  stats.health = health(stats);
  return { users, stats };
}

// Green: every active user was reached this morning without failures and the last run passed.
function health(s) {
  const problems = [], warnings = [];
  if (!s.services[0][1]) problems.push("Email sending is not set up, so nobody gets jobs.");
  if (s.lastRun && s.lastRun.conclusion !== "success") problems.push(`The last morning run ended "${s.lastRun.conclusion}".`);
  if (s.failed) problems.push(`${s.failed} user${s.failed === 1 ? "" : "s"} failed this morning.`);
  if (s.missed && s.active) {
    const msg = `${s.missed} of ${s.active} active user${s.active === 1 ? " was" : "s were"} not reached this morning.`;
    (s.missed * 2 > s.active ? problems : warnings).push(msg);
  }
  if (s.runs === null) warnings.push("Can't read the run history (the GitHub token is missing or lacks access).");
  if (s.runs?.[0] && s.runs[0].status !== "completed") warnings.push("A run is in progress right now.");
  if (!s.services[1][1]) warnings.push("Payments are off.");
  const level = problems.length ? "red" : warnings.length ? "amber" : "green";
  const headline = { red: "Needs attention", amber: "Mostly fine", green: "All good" }[level];
  return { level, headline, notes: [...problems, ...warnings] };
}

const LAGOS = { timeZone: "Africa/Lagos" };
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { ...LAGOS, day: "numeric", month: "short", year: "numeric" }) : "");
const fmtTime = (d) => (d ? new Date(d).toLocaleString("en-GB", { ...LAGOS, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const naira = (n) => `₦${Number(n || 0).toLocaleString("en")}`;

const STYLE = `
  :root { --bg:#f6f7f9; --card:#fff; --text:#1d2433; --muted:#5b6475; --border:#dfe3ea; --green:#127a3e; --amber:#9a5b00; --red:#b42318; --accent:#2457d6; }
  @media (prefers-color-scheme: dark) { :root { --bg:#12151b; --card:#1b2029; --text:#e8ebf1; --muted:#a2abbb; --border:#2c3340; --green:#5fd18f; --amber:#f0b44c; --red:#ff8a80; --accent:#7aa2ff; } }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--text); }
  main { max-width:880px; margin:0 auto; padding:20px 16px 48px; }
  h1 { font-size:20px; margin:0 0 4px; } h2 { font-size:16px; margin:28px 0 10px; }
  .muted { color:var(--muted); } a { color:var(--accent); }
  .card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:14px 16px; }
  .health { border-left:6px solid var(--c); } .health b.big { font-size:22px; color:var(--c); display:block; }
  .green { --c:var(--green); } .amber { --c:var(--amber); } .red { --c:var(--red); }
  .health ul { margin:8px 0 0; padding-left:18px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; margin-top:12px; }
  .grid .card { padding:10px 12px; } .grid b { display:block; font-size:22px; }
  .list { list-style:none; margin:0; padding:0; display:grid; gap:8px; }
  .list li { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:10px 12px; }
  .row { display:flex; flex-wrap:wrap; gap:6px 12px; align-items:baseline; }
  .email { font-weight:600; overflow-wrap:anywhere; }
  .pill { font-size:12px; padding:1px 8px; border-radius:99px; border:1px solid currentColor; }
  .ok { color:var(--green); } .warn { color:var(--amber); } .bad { color:var(--red); }
  .small { font-size:13px; }
`;

const PILL = { member: "ok", trial: "warn", expired: "bad", unconfirmed: "muted" };

function userRow(u) {
  const plan = u.status === "member" || u.status === "trial" ? `${u.status} until ${fmtDay(u.paid_until)}`
    : u.status === "expired" ? `expired ${fmtDay(u.paid_until)}` : "unconfirmed";
  const where = u.remote_only ? "remote" : `on-site near ${u.city || "?"}`;
  let morning;
  if (!u.confirmed) morning = `<span class="muted">Not searched until they confirm their email</span>`;
  else if (u.status === "expired") morning = `<span class="muted">Not searched: their trial or membership has ended</span>`;
  else if (u.ranToday) morning = `<span class="${u.failed ? "bad" : "ok"}">${u.failed ? "✗" : "✓"} This morning: ${esc(u.last_run_result)}</span> <span class="muted">${fmtTime(u.last_run_at)}</span>`;
  else if (u.last_run_at) morning = `<span class="warn">⚠ Not reached this morning.</span> <span class="muted">Last: ${esc(u.last_run_result)}, ${fmtTime(u.last_run_at)}</span>`;
  else morning = `<span class="warn">⚠ No search recorded yet</span>`;
  return `<li><div class="row"><span class="email">${esc(u.email)}</span><span class="pill ${PILL[u.status]}">${esc(plan)}</span></div>
<div class="small muted">${esc((u.keywords || "").replace(/,\s*/g, ", "))} · ${esc(u.country || "any country")} · ${esc(where)} · joined ${fmtDay(u.created_at)}${u.telegram ? " · Telegram" : ""}</div>
<div class="small">${morning}</div>
<div class="small muted">${u.jobs_sent} job${u.jobs_sent === 1 ? "" : "s"} sent in total${u.last_job_at ? `, last on ${fmtDay(u.last_job_at)}` : ""}</div></li>`;
}

export function render(siteName, { users, stats: s }, now = new Date()) {
  const h = s.health;
  const tile = (n, label) => `<div class="card"><b>${n}</b><span class="muted small">${label}</span></div>`;
  const runs = s.runs === null ? `<p class="muted small">Run history unavailable.</p>` : !s.runs.length ? `<p class="muted small">No runs yet.</p>`
    : `<ul class="list">${s.runs.map((r) => {
        const state = r.status !== "completed" ? ["warn", "running"] : r.conclusion === "success" ? ["ok", "passed"] : ["bad", r.conclusion];
        const kind = r.event === "schedule" ? "fallback schedule" : r.event === "workflow_dispatch" ? "started by the site" : r.event;
        return `<li class="small"><div class="row"><span class="${state[0]}">${esc(state[1])}</span><span>${fmtTime(r.when)}</span><span class="muted">${esc(kind)}</span><a href="${esc(r.url)}" rel="noreferrer">log</a></div></li>`;
      }).join("")}</ul>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<title>${esc(siteName)} dashboard</title><style>${STYLE}</style></head>
<body><main>
<h1>${esc(siteName)} dashboard</h1>
<p class="muted small">Updated ${fmtTime(now)} (Nigeria time). "This morning" means since ${fmtTime(s.since)}.</p>

<div class="card health ${h.level}"><b class="big">${h.headline}</b>
<span>${s.reached} of ${s.active} active users searched this morning: ${s.sent} got jobs, ${s.none} had no new matches${s.failed ? `, <span class="bad">${s.failed} failed</span>` : ""}.</span>
${h.notes.length ? `<ul>${h.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}</div>

<div class="grid">${tile(s.users, "signed up")}${tile(s.confirmed, "confirmed")}${tile(s.member, "paying members")}${tile(s.trial, "on free trial")}${tile(s.expired, "expired")}${tile(s.unconfirmed, "unconfirmed")}${tile(naira(s.revenue.month), "paid, last 30 days")}${tile(naira(s.revenue.total), "paid in total")}</div>

<h2>Morning runs</h2>${runs}

<h2>Services</h2>
<ul class="list">${s.services.map(([name, on]) => `<li class="small"><span class="${on ? "ok" : "muted"}">${on ? "✓ On" : "○ Off"}</span> ${esc(name)}</li>`).join("")}</ul>

<h2>Users (${users.length})</h2>
<ul class="list">${users.map(userRow).join("")}</ul>
</main></body></html>`;
}
