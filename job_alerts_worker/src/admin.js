// The owner's private dashboard at /admin (password = ADMIN_KEY, remembered in a cookie)
// or straight from /admin/<ADMIN_KEY>: every subscriber, whether this
// morning's job search reached them (send_daily.py records last_run_at/last_run_result),
// and a one-line verdict on the system's health. Without ADMIN_KEY the page doesn't exist.
import { esc } from "./views.js";
import * as payments from "./payments.js";
import * as telegram from "./telegram.js";
import * as firstSearch from "./firstsearch.js";
import * as letters from "./letters.js";

const MIN_KEY = 12; // shorter keys leave the dashboard off

const COOKIE = "ja_admin";
const adminKey = (env) => (env.ADMIN_KEY || "").trim();
export const enabled = (env) => adminKey(env).length >= MIN_KEY;
const digest = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

// Long error messages (database errors run to several lines) are cut to one short line; the full text shows on hover.
const SHORT = 80;
export function short(result) {
  const line = String(result || "").split("\n")[0].replace(/\((?:psycopg|sqlalchemy)[\w.]*\.(\w+)\)/, "$1").replace(/\s+/g, " ").trim();
  return line.length > SHORT ? `${line.slice(0, SHORT - 1).trimEnd()}…` : line;
}
const full = (result) => (short(result) !== String(result || "").trim() ? ` title="${esc(result)}"` : "");

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
    const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO.trim()}/actions/workflows/job_alerts_daily.yml/runs?per_page=30`, {
      headers: { authorization: `Bearer ${env.GH_TOKEN.trim()}`, accept: "application/vnd.github+json", "user-agent": "jobalert-worker" },
    });
    if (!r.ok) return null;
    // Code checks on pull requests run the same workflow; they aren't job runs.
    return ((await r.json()).workflow_runs || []).filter((w) => w.event !== "pull_request").slice(0, 6).map((w) => ({
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
              s.last_run_at, s.last_run_result, s.telegram_chat_id IS NOT NULL AS telegram, s.heard,
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
    // Joined after this morning's run: their first search, not the morning run, is what counts today.
    u.newToday = new Date(u.created_at) >= new Date(since.getTime() + 90 * 60 * 1000);
    // Confirmed over 30 minutes ago and still nothing: the first search never ran for them.
    u.neverSearched = u.confirmed && !u.last_run_at && !u.jobs_sent && now - new Date(u.created_at) > 30 * 60 * 1000;
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
    failed: today.filter((u) => u.failed).length,
    missed: active.filter((u) => !u.ranToday && !u.newToday).length, due: active.filter((u) => !u.newToday).length,
    neverSearched: active.filter((u) => u.neverSearched).length,
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
  if (s.neverSearched) {
    problems.push(`${s.neverSearched} active user${s.neverSearched === 1 ? " has" : "s have"} never had a job search. ` +
      "The site couldn't start their first search: check the GitHub token can run workflows (Actions: Read and write).");
  }
  if (s.missed && s.due) {
    const msg = `${s.missed} of ${s.due} active user${s.due === 1 ? " was" : "s were"} not reached this morning.`;
    (s.missed * 2 > s.due ? problems : warnings).push(msg);
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
  :root { --bg:#f3f5f8; --card:#fff; --card2:#f8f9fb; --text:#161b26; --muted:#5d6678; --border:#e1e5ec; --green:#13804a; --amber:#a35f00; --red:#c0281b; --accent:#2f5bea; --gray:#9aa3b2; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0e1116; --card:#171b22; --card2:#1d222b; --text:#e9ecf2; --muted:#9aa4b5; --border:#262d39; --green:#4fd18b; --amber:#f2b74f; --red:#ff7f74; --accent:#7f9dff; --gray:#5d6678; } }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.45 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--text); }
  main { max-width:1440px; margin:0 auto; padding:24px 32px 56px; }
  a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
  .muted { color:var(--muted); } .small { font-size:12.5px; }
  .ok { color:var(--green); } .warn { color:var(--amber); } .bad { color:var(--red); }
  .green { --c:var(--green); } .amber { --c:var(--amber); } .red { --c:var(--red); }
  header.top { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:20px; }
  header.top h1 { font-size:22px; margin:0; letter-spacing:-.01em; }
  .status { display:inline-flex; align-items:center; gap:8px; padding:6px 14px; border-radius:99px; font-weight:600; color:var(--c);
    background:color-mix(in srgb, var(--c) 12%, transparent); border:1px solid color-mix(in srgb, var(--c) 35%, transparent); }
  .dot { width:8px; height:8px; border-radius:50%; background:currentColor; display:inline-block; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:18px 20px; }
  .card h2 { font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:0 0 14px; font-weight:600; }
  .kpis { display:grid; grid-template-columns:repeat(8,minmax(0,1fr)); gap:12px; margin-bottom:16px; }
  .kpi { padding:14px 16px; } .kpi b { display:block; font-size:26px; font-weight:700; letter-spacing:-.02em; } .kpi span { color:var(--muted); font-size:12.5px; }
  .kpi.money b { color:var(--green); }
  .cols { display:grid; grid-template-columns:minmax(0,1.5fr) minmax(0,1fr) minmax(0,.9fr); gap:16px; margin-bottom:16px; }
  .health { border-left:5px solid var(--c); }
  .health .big { font-size:24px; font-weight:700; color:var(--c); margin:0 0 4px; }
  .health ul { margin:10px 0 0; padding-left:18px; } .health li { margin:4px 0; }
  .bar { display:flex; height:12px; border-radius:99px; overflow:hidden; background:var(--card2); margin:16px 0 10px; }
  .bar i { display:block; height:100%; }
  .legend { display:flex; flex-wrap:wrap; gap:6px 16px; font-size:12.5px; color:var(--muted); }
  .mini { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-top:18px; }
  .mini div { background:var(--card2); border-radius:10px; padding:10px 12px; } .mini b { display:block; font-size:18px; } .mini span { font-size:12px; color:var(--muted); }
  .legend b { color:var(--text); }
  .sw { width:10px; height:10px; border-radius:3px; display:inline-block; margin-right:5px; vertical-align:-1px; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:11.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); font-weight:600; padding:8px 10px; border-bottom:1px solid var(--border); white-space:nowrap; }
  td { padding:9px 10px; border-bottom:1px solid var(--border); vertical-align:top; }
  tr:last-child td { border-bottom:0; }
  .runs td, .services td { padding:7px 6px; } .runs td { white-space:nowrap; } .runs th, .services th { padding:6px; }
  .pill { display:inline-block; font-size:11.5px; font-weight:600; padding:2px 9px; border-radius:99px; white-space:nowrap; color:var(--c, var(--muted));
    background:color-mix(in srgb, var(--c, var(--gray)) 13%, transparent); }
  .pill.member { --c:var(--green); } .pill.trial { --c:var(--accent); } .pill.expired { --c:var(--red); } .pill.unconfirmed { --c:var(--gray); }
  .toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
  .tabs { display:flex; gap:4px; background:var(--card2); border:1px solid var(--border); border-radius:10px; padding:3px; }
  .tabs button { font:inherit; font-size:13px; border:0; background:none; color:var(--muted); padding:6px 12px; border-radius:7px; cursor:pointer; }
  .tabs button.on { background:var(--card); color:var(--text); box-shadow:0 1px 2px rgba(0,0,0,.12); font-weight:600; }
  .tabs button em { font-style:normal; color:var(--muted); margin-left:4px; font-weight:400; }
  input[type=search] { font:inherit; width:280px; padding:8px 12px; border-radius:9px; border:1px solid var(--border); background:var(--card2); color:var(--text); }
  .users td { font-size:13.5px; } .users tbody tr:hover { background:var(--card2); }
  .email { font-weight:600; overflow-wrap:anywhere; }
  .num { text-align:right; font-variant-numeric:tabular-nums; }
  .titles { max-width:300px; }
  .empty { padding:24px; text-align:center; color:var(--muted); display:none; }
  @media (max-width:1100px) { .kpis { grid-template-columns:repeat(4,minmax(0,1fr)); } .cols { grid-template-columns:1fr; } main { padding:20px 16px 48px; } .users { display:block; overflow-x:auto; } }
`;

const PLAN = { member: "Member", trial: "Free trial", expired: "Expired", unconfirmed: "Unconfirmed" };

function morning(u) {
  if (!u.confirmed) return `<span class="muted">Not searched until they confirm their email</span>`;
  if (u.status === "expired") return `<span class="muted">Not searched: their trial or membership has ended</span>`;
  if (u.ranToday) return `<span class="${u.failed ? "bad" : "ok"}"${full(u.last_run_result)}>${u.failed ? "✗" : "✓"} This morning: ${esc(short(u.last_run_result))}</span><div class="small muted">${fmtTime(u.last_run_at)}</div>`;
  if (u.last_run_at) return `<span class="warn">⚠ Not reached this morning.</span><div class="small muted"${full(u.last_run_result)}>Last: ${esc(short(u.last_run_result))}, ${fmtTime(u.last_run_at)}</div>`;
  if (u.neverSearched) return `<span class="bad">✗ Never searched: their first search didn't start</span>`;
  return `<span class="warn">⚠ No search recorded yet</span>`;
}

function userRow(u) {
  const active = u.status === "member" || u.status === "trial";
  const attention = active && (u.failed || u.neverSearched || (!u.ranToday && !u.newToday));
  const until = active ? `${u.status} until ${fmtDay(u.paid_until)}` : u.status === "expired" ? `ended ${fmtDay(u.paid_until)}` : "";
  const where = u.remote_only ? "Remote" : `On-site, ${u.city || "?"}`;
  const tags = [u.status, active ? "active" : "", attention ? "attention" : ""].join(" ");
  return `<tr data-tags="${tags}">
<td><div class="email">${esc(u.email)}</div><div class="small muted">Joined ${fmtDay(u.created_at)}${u.telegram ? " · Telegram" : ""}</div></td>
<td><span class="pill ${u.status}">${PLAN[u.status]}</span>${until ? `<div class="small muted">${esc(until)}</div>` : ""}</td>
<td class="titles">${esc((u.keywords || "").replace(/,\s*/g, ", "))}</td>
<td>${esc(u.country || "Any country")}<div class="small muted">${esc(where)}</div></td>
<td>${morning(u)}</td>
<td class="num"><b>${u.jobs_sent}</b>${u.last_job_at ? `<div class="small muted">last ${fmtDay(u.last_job_at)}</div>` : ""}</td>
</tr>`;
}

const SCRIPT = `
(() => {
  const rows = [...document.querySelectorAll(".users tbody tr")], q = document.getElementById("q"), empty = document.querySelector(".empty");
  let tab = "all";
  const apply = () => {
    const term = q.value.trim().toLowerCase(); let shown = 0;
    for (const r of rows) {
      const ok = (tab === "all" || r.dataset.tags.split(" ").includes(tab)) && (!term || r.textContent.toLowerCase().includes(term));
      r.style.display = ok ? "" : "none"; shown += ok;
    }
    empty.style.display = shown ? "none" : "block";
  };
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b)); tab = b.dataset.tab; apply();
  }));
  q.addEventListener("input", apply);
})();
`;

// Sign-ups and paying members per "How did you hear about us?" answer, most sign-ups first.
function heardTable(users) {
  const rows = {};
  for (const u of users) {
    const r = (rows[u.heard || "Not asked or skipped"] ||= { n: 0, members: 0 });
    r.n++;
    if (u.member) r.members++;
  }
  const list = Object.entries(rows).sort((a, b) => b[1].n - a[1].n);
  return `<table class="services"><thead><tr><th>Source</th><th class="num">Signed up</th><th class="num">Members</th></tr></thead><tbody>${list
    .map(([k, r]) => `<tr><td>${esc(k)}</td><td class="num">${r.n}</td><td class="num">${r.members}</td></tr>`).join("")}</tbody></table>`;
}

export function render(siteName, { users, stats: s }, now = new Date()) {
  const h = s.health;
  const kpi = (n, label, cls = "") => `<div class="card kpi ${cls}"><b>${n}</b><span>${label}</span></div>`;
  const notReached = Math.max(0, s.active - s.reached);
  const pct = (n) => (s.active ? (n / s.active) * 100 : 0);
  const seg = (n, color) => (n ? `<i style="width:${pct(n)}%;background:var(${color})"></i>` : "");
  const runs = s.runs === null ? `<p class="muted small">Run history unavailable.</p>` : !s.runs.length ? `<p class="muted small">No runs yet.</p>`
    : `<table class="runs"><thead><tr><th>Result</th><th>Started</th><th>Trigger</th><th></th></tr></thead><tbody>${s.runs.map((r) => {
        const state = r.status !== "completed" ? ["warn", "running"] : r.conclusion === "success" ? ["ok", "passed"] : ["bad", r.conclusion];
        const kind = r.event === "schedule" ? "Fallback schedule" : r.event === "workflow_dispatch" ? "Started by the site" : r.event;
        return `<tr><td><span class="${state[0]}"><span class="dot"></span> ${esc(state[1])}</span></td><td>${fmtTime(r.when)}</td><td class="muted">${esc(kind)}</td><td class="num"><a href="${esc(r.url)}" rel="noreferrer">Log</a></td></tr>`;
      }).join("")}</tbody></table>`;
  const attention = users.filter((u) => (u.status === "member" || u.status === "trial") && (u.failed || u.neverSearched || (!u.ranToday && !u.newToday))).length;
  const newToday = users.filter((u) => u.confirmed && u.newToday).length;
  const tab = (key, label, n, on = false) => `<button data-tab="${key}"${on ? ' class="on"' : ""}>${label}<em>${n}</em></button>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<title>${esc(siteName)} dashboard</title><style>${STYLE}</style></head>
<body><main>
<header class="top"><div><h1>${esc(siteName)} dashboard</h1>
<div class="muted small">Updated ${fmtTime(now)} (Nigeria time). "This morning" means since ${fmtTime(s.since)}.</div></div>
<span class="status ${h.level}"><span class="dot"></span>${h.headline}</span></header>

<section class="kpis">${kpi(s.users, "Signed up")}${kpi(s.confirmed, "Confirmed")}${kpi(s.active, "Active now")}${kpi(s.member, "Paying members")}${kpi(s.trial, "On free trial")}${kpi(s.unconfirmed, "Unconfirmed")}${kpi(naira(s.revenue.month), "Paid, last 30 days", "money")}${kpi(naira(s.revenue.total), "Paid in total", "money")}</section>

<section class="cols">
<div class="card health ${h.level}"><h2>System health</h2><p class="big">${h.headline}</p>
<span>${s.reached} of ${s.active} active users searched this morning: ${s.sent} got jobs, ${s.none} had no new matches${s.failed ? `, <span class="bad">${s.failed} failed</span>` : ""}.</span>
<div class="bar">${seg(s.sent, "--green")}${seg(s.none, "--accent")}${seg(s.failed, "--red")}${seg(notReached, "--amber")}</div>
<div class="legend"><span><i class="sw" style="background:var(--green)"></i>Got jobs <b>${s.sent}</b></span><span><i class="sw" style="background:var(--accent)"></i>No new matches <b>${s.none}</b></span><span><i class="sw" style="background:var(--red)"></i>Failed <b>${s.failed}</b></span><span><i class="sw" style="background:var(--amber)"></i>Not reached yet <b>${notReached}</b></span></div>
${h.notes.length ? `<ul>${h.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
<div class="mini"><div><b>${s.active ? Math.round((s.reached / s.active) * 100) : 0}%</b><span>reached this morning</span></div>
<div><b>${newToday}</b><span>joined since the run</span></div>
<div><b class="${attention ? "warn" : ""}">${attention}</b><span>need attention</span></div>
<div><b>${users.reduce((n, u) => n + (u.jobs_sent || 0), 0)}</b><span>jobs sent in total</span></div></div></div>

<div class="card"><h2>Morning runs</h2>${runs}</div>

<div class="card"><h2>How people heard about us</h2>${heardTable(users)}</div>

<div class="card"><h2>Services</h2><table class="services"><tbody>${s.services.map(([name, on]) => `<tr><td>${esc(name)}</td><td class="num"><span class="pill" style="--c:var(${on ? "--green" : "--gray"})">${on ? "On" : "Off"}</span></td></tr>`).join("")}</tbody></table>
</div>
</section>

<section class="card">
<div class="toolbar"><div class="tabs">${tab("all", "All users", users.length, true)}${tab("active", "Active", s.active)}${tab("attention", "Needs attention", attention)}${tab("member", "Members", s.member)}${tab("trial", "Trial", s.trial)}${tab("unconfirmed", "Unconfirmed", s.unconfirmed)}${tab("expired", "Expired", s.expired)}</div>
<input type="search" id="q" placeholder="Search email, job title, country…" aria-label="Search users"></div>
<table class="users"><thead><tr><th>User</th><th>Plan</th><th>Job titles</th><th>Location</th><th>This morning</th><th class="num">Jobs sent</th></tr></thead>
<tbody>${users.map(userRow).join("")}</tbody></table>
<div class="empty">No users match.</div>
</section>
</main><script>${SCRIPT}</script></body></html>`;
}
