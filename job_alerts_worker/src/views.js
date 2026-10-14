// HTML pages, ported from job_alerts/templates (the Python site). Every value
// that comes from a user or the database goes through esc().
import COUNTRIES from "./countries.js";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const STYLE = `
  :root { --bg:#f6f7f9; --card:#fff; --text:#1d2433; --muted:#5b6475; --accent:#2457d6; --border:#dfe3ea; --ok:#127a3e; --on-accent:#fff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#12151b; --card:#1b2029; --text:#e8ebf1; --muted:#a2abbb; --accent:#7aa2ff; --border:#2c3340; --ok:#5fd18f; --on-accent:#0b1530; } }
  * { box-sizing: border-box; }
  body { margin:0; font:16px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:var(--bg); color:var(--text); }
  main { max-width:560px; margin:0 auto; padding:32px 16px 48px; }
  h1 { font-size:1.6rem; margin:0 0 4px; }
  p.lead { color:var(--muted); margin:0 0 24px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:20px; }
  label { display:block; font-weight:600; margin:16px 0 6px; }
  .hint { font-weight:400; color:var(--muted); font-size:.9rem; }
  input[type=email], input[type=text], select, textarea { width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--text); font-size:1rem; }
  .row { display:flex; gap:10px; align-items:center; margin-top:14px; }
  button { margin-top:22px; width:100%; padding:12px; border:0; border-radius:8px; background:var(--accent); color:var(--on-accent); font-size:1rem; font-weight:600; cursor:pointer; }
  .hp { position:absolute; left:-9999px; }
  .ok { color:var(--ok); font-weight:600; }
  .small { font-size:.85rem; color:var(--muted); margin-top:18px; }
  a { color:var(--accent); }
  .status { padding:12px 16px; margin:0 0 16px; }
  .plan { --tone:var(--accent); position:relative; overflow:hidden; margin:0 0 16px; padding:20px; border-radius:16px; color:var(--text);
    background:linear-gradient(135deg, color-mix(in srgb, var(--tone) 16%, var(--card)), var(--card) 70%); border:1px solid color-mix(in srgb, var(--tone) 35%, var(--border));
    box-shadow:0 10px 30px -18px color-mix(in srgb, var(--tone) 70%, transparent); }
  .plan::after { content:""; position:absolute; right:-40px; top:-40px; width:140px; height:140px; border-radius:50%; background:color-mix(in srgb, var(--tone) 14%, transparent); }
  .plan.member { --tone:var(--ok); } .plan.off { --tone:#d92d20; }
  .plan-top { display:flex; justify-content:space-between; align-items:center; gap:10px; position:relative; z-index:1; }
  .badge { font-size:.78rem; font-weight:800; letter-spacing:.04em; text-transform:uppercase; padding:4px 10px; border-radius:99px; color:var(--tone); background:color-mix(in srgb, var(--tone) 14%, transparent); }
  .plan-price { font-weight:700; } .plan-price small { color:var(--muted); font-weight:500; }
  .plan-head { font-size:1.7rem; font-weight:800; margin:14px 0 0; letter-spacing:-.01em; position:relative; z-index:1; }
  .plan-sub { color:var(--muted); margin:2px 0 0; }
  .meter { height:8px; border-radius:99px; background:color-mix(in srgb, var(--tone) 15%, var(--bg)); margin:14px 0 0; overflow:hidden; }
  .meter span { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg, var(--tone), color-mix(in srgb, var(--tone) 60%, #fff)); }
  .plan-cta { display:flex; justify-content:center; gap:8px; margin-top:18px; padding:13px 16px; border-radius:12px; font-weight:700; text-decoration:none; position:relative; z-index:1;
    color:var(--on-accent); background:linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #7c3aed)); box-shadow:0 8px 20px -10px var(--accent); transition:transform .15s, box-shadow .15s; }
  .plan-cta:hover { transform:translateY(-1px); box-shadow:0 12px 24px -10px var(--accent); }
  .plan-cta span { transition:transform .15s; } .plan-cta:hover span { transform:translateX(3px); }
  .plan-note { font-size:.8rem; color:var(--muted); text-align:center; margin:10px 0 0; }
  @media (prefers-reduced-motion: reduce) { .plan-cta, .plan-cta span { transition:none; } }
  .price { font-size:1.2rem; margin:0 0 8px; }
  .price b { font-size:1.8rem; }
  .perks { padding-left:20px; margin:0; }
  .perks li { margin:6px 0; }
  footer { margin-top:28px; font-size:.85rem; color:var(--muted); text-align:center; }
  fieldset { border:0; padding:0; margin:16px 0 0; }
  legend { font-weight:600; padding:0; margin-bottom:2px; }
  .row { margin-top:8px; }
  [hidden] { display:none !important; }
  button:disabled { opacity:.7; cursor:wait; }
  .hero { text-align:center; margin:4px 0 22px; }
  .hero svg { width:132px; height:132px; display:block; margin:0 auto 10px; }
  .hero h1 { font-size:1.9rem; margin:0; }
  .hero p { color:var(--muted); margin:6px 0 0; font-size:1.05rem; }
  .pill { display:inline-block; margin-top:12px; padding:6px 14px; border-radius:20px; background:color-mix(in srgb, var(--ok) 14%, transparent); color:var(--ok); font-weight:700; font-size:.92rem; }
  .steps { list-style:none; margin:0; padding:0; }
  .steps li { position:relative; padding:0 0 18px 44px; }
  .steps li:last-child { padding-bottom:0; }
  .steps li::before { content:""; position:absolute; left:13px; top:30px; bottom:2px; width:2px; background:var(--border); }
  .steps li:last-child::before { display:none; }
  .steps .dot { position:absolute; left:0; top:0; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:.85rem; background:var(--bg); color:var(--muted); border:2px solid var(--border); }
  .steps .done .dot { background:var(--ok); border-color:var(--ok); color:#fff; }
  .steps .now .dot { background:var(--accent); border-color:var(--accent); color:var(--on-accent); }
  .steps .now .dot::after { content:""; position:absolute; inset:-6px; border-radius:50%; border:2px solid var(--accent); animation:pulse 1.6s ease-out infinite; }
  @keyframes pulse { from { opacity:.8; transform:scale(.8); } to { opacity:0; transform:scale(1.35); } }
  @keyframes rise { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-6px); } }
  .float { animation:rise 3s ease-in-out infinite; transform-origin:center; }
  @media (prefers-reduced-motion: reduce) { .steps .now .dot::after, .float { animation:none; } }
  .steps b { display:block; }
  .steps span { color:var(--muted); font-size:.92rem; }
  .actions { display:grid; gap:10px; margin-top:18px; }
  .btn { display:block; text-align:center; padding:12px; border-radius:8px; font-weight:700; text-decoration:none; }
  .btn.primary { background:var(--accent); color:var(--on-accent); }
  .btn.ghost { border:1px solid var(--border); color:var(--text); background:var(--card); }
  .btn.wa { background:#1fa855; color:#fff; }
  .note { margin-top:16px; font-size:.9rem; color:var(--muted); text-align:center; }
  .plans { display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:12px; margin:28px 0 0; }
  .plans h2 { grid-column:1 / -1; font-size:1.3rem; margin:0; }
  .plan { position:relative; }
  .plan.best { border:2px solid var(--accent); }
  .plan .tag { position:absolute; top:-11px; right:14px; background:var(--accent); color:var(--on-accent); font-size:.75rem; font-weight:800; padding:3px 10px; border-radius:20px; }
  .plan h3 { margin:0; font-size:1.1rem; }
  .plan .cost { margin:4px 0 12px; color:var(--muted); }
  .plan .cost b { color:var(--text); font-size:1.5rem; }
  .plan ul { list-style:none; padding:0; margin:0; }
  .plan li { padding:5px 0 5px 26px; position:relative; }
  .plan li::before { content:"✓"; position:absolute; left:0; color:var(--ok); font-weight:800; }
  .plan li.no { color:var(--muted); }
  .plan li.no::before { content:"–"; color:var(--muted); }
  .home h1 { font-size:2.1rem; line-height:1.15; letter-spacing:-.5px; }
  .home h1 em { font-style:normal; color:var(--accent); }
  .home p.lead { font-size:1.08rem; margin-bottom:18px; }
  .cta { display:inline-block; padding:13px 22px; border-radius:10px; background:var(--accent); color:var(--on-accent); font-weight:800; text-decoration:none; margin:0 0 24px; }
  .why { display:grid; gap:12px; margin:0 0 22px; }
  .why .card { display:grid; grid-template-columns:48px 1fr; gap:14px; align-items:start; padding:16px 18px; }
  .why .ico { width:48px; height:48px; border-radius:12px; display:flex; align-items:center; justify-content:center; }
  .why .ico svg { width:26px; height:26px; }
  .why h3 { margin:0 0 3px; font-size:1.05rem; }
  .why p { margin:0; color:var(--muted); font-size:.95rem; }
  .ico.blue { background:color-mix(in srgb, var(--accent) 14%, transparent); color:var(--accent); }
  .ico.gold { background:#fff3d6; color:#b7791f; }
  .ico.green { background:color-mix(in srgb, var(--ok) 14%, transparent); color:var(--ok); }
  @media (prefers-color-scheme: dark) { .ico.gold { background:#3a2f12; color:#ffc75a; } }
  .vs { margin:28px 0 0; }
  .vs h2 { font-size:1.3rem; margin:0 0 12px; }
  .vs table { width:100%; border-collapse:collapse; font-size:.9rem; table-layout:fixed; }
  .vs col.a { width:30%; } .vs col.b { width:33%; }
  .vs th, .vs td { padding:10px 6px; overflow-wrap:anywhere; border-bottom:1px solid var(--border); text-align:left; vertical-align:top; }
  .vs tr:last-child td { border-bottom:0; }
  .vs th { font-size:.8rem; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
  .vs td.us { color:var(--ok); font-weight:700; }
  .vs td.them { color:var(--muted); }
  details.fold > summary { cursor:pointer; list-style:none; font-weight:700; color:var(--accent); padding:4px 0; }
  details.fold > summary::-webkit-details-marker { display:none; }
  details.fold > summary::after { content:"▾"; display:inline-block; margin-left:6px; transition:transform .2s; }
  details.fold[open] > summary::after { transform:rotate(180deg); }
  details.more { margin-top:18px; }
  details.pick { position:relative; }
  details.pick > summary { list-style:none; cursor:pointer; padding:10px 36px 10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--bg); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  details.pick > summary::-webkit-details-marker { display:none; }
  details.pick > summary::after { content:"▾"; position:absolute; right:12px; top:10px; color:var(--muted); }
  details.pick > summary.empty { color:var(--muted); }
  details.pick .opts { border:1px solid var(--border); border-radius:8px; padding:6px 12px 10px; margin-top:4px; background:var(--bg); }
  details.pick .row { margin:6px 0; }
  details.pick .row label { margin:0; font-weight:400; }
  details.info { margin-top:22px; text-align:center; }
  details.info[open] { text-align:left; }
  details.info > summary { text-align:center; }
  details.info .why { margin-top:16px; }
  .free { text-align:center; margin:12px 0 0; font-size:.9rem; color:var(--muted); }
  textarea { font:inherit; line-height:1.5; resize:vertical; }
  .invite { margin-top:16px; }
  .invite .bar { height:8px; border-radius:4px; background:var(--border); margin:10px 0 4px; overflow:hidden; }
  .invite .bar i { display:block; height:100%; background:var(--ok); }
  .brand { display:inline-flex; align-items:center; gap:10px; margin:0 0 20px; text-decoration:none; color:var(--text); font-size:1.35rem; font-weight:800; letter-spacing:-.3px; }
  .brand b { color:var(--accent); }
  .brand img { border-radius:9px; }
`;

const DESCRIPTION = "Remote jobs from companies abroad that actually hire Nigerians, checked for scams and never repeated, in your inbox every morning. 7 days free.";

export function page(ctx, body) {
  const footer = `<footer><a href="/terms">Terms, pricing and refunds</a>${
    ctx.contact ? ` &middot; <a href="mailto:${esc(ctx.contact)}">Contact</a>` : ""}</footer>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(ctx.siteName)}</title>
<meta name="description" content="${esc(DESCRIPTION)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.png" type="image/png" sizes="48x48">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#2457d6">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(ctx.siteName)}">
<meta property="og:title" content="${esc(ctx.siteName)}: remote jobs that actually hire Nigerians">
<meta property="og:description" content="${esc(DESCRIPTION)}">
<meta property="og:url" content="${esc(ctx.baseUrl)}/">
<meta property="og:image" content="${esc(ctx.baseUrl)}/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(ctx.siteName)}: remote jobs that actually hire Nigerians, in your inbox every morning">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(ctx.baseUrl)}/og.jpg">
<style>${STYLE}</style>
</head>
<body><main><a class="brand" href="/"><img src="/favicon.svg" alt="" width="36" height="36"><span>Job<b>Alert</b></span></a>
${body}
${footer}</main></body>
</html>`;
}

export function message(ctx, { heading, text, ok = false, link = null, linkText = null }) {
  return page(ctx, `<h1>${esc(heading)}</h1>
<div class="card"><p${ok ? ' class="ok"' : ""}>${esc(text)}</p>
${link ? `<p><a href="${esc(link)}">${esc(linkText)}</a></p>` : ""}</div>`);
}

// Illustrations for the welcome and check-your-inbox pages (inline SVG, brand colours).
const ART_ROCKET = `<svg viewBox="0 0 160 160" aria-hidden="true">
  <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f1f4d"/><stop offset="1" stop-color="#2457d6"/></linearGradient></defs>
  <circle cx="80" cy="80" r="76" fill="url(#g1)"/>
  <circle cx="38" cy="44" r="3" fill="#fff" opacity=".7"/><circle cx="124" cy="36" r="2.5" fill="#fff" opacity=".6"/><circle cx="130" cy="104" r="3" fill="#fff" opacity=".5"/>
  <g class="float">
    <path d="M80 30c18 12 24 34 18 58H62c-6-24 0-46 18-58z" fill="#fff"/>
    <circle cx="80" cy="62" r="9" fill="#2457d6"/><circle cx="80" cy="62" r="4" fill="#ffc75a"/>
    <path d="M62 78l-12 16 16-4zM98 78l12 16-16-4z" fill="#ffc75a"/>
    <path d="M70 94h20l-4 14h-12z" fill="#f5a524"/><path d="M74 108h12l-6 14z" fill="#ffc75a"/>
  </g>
</svg>`;

const ART_MAIL = `<svg viewBox="0 0 160 160" aria-hidden="true">
  <defs><linearGradient id="g2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f1f4d"/><stop offset="1" stop-color="#2457d6"/></linearGradient></defs>
  <circle cx="80" cy="80" r="76" fill="url(#g2)"/>
  <g class="float">
    <rect x="34" y="52" width="92" height="62" rx="10" fill="#fff"/>
    <path d="M36 58l44 32 44-32" fill="none" stroke="#2457d6" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="122" cy="52" r="13" fill="#f5a524" stroke="#fff" stroke-width="4"/>
    <text x="122" y="57" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="15" font-weight="800" fill="#fff">1</text>
  </g>
</svg>`;

const steps = (list) => `<ol class="steps">${list.map(([state, title, detail], i) =>
  `<li class="${state}"><span class="dot">${state === "done" ? "&#10003;" : i + 1}</span><b>${esc(title)}</b><span>${esc(detail)}</span></li>`).join("")}</ol>`;

// "You're in": shown after confirming an email or paying.
// "Invite 2 friends, get a month free": the WhatsApp share carries their invite link.
export function invite(ctx, { refLink, joined = 0, perReward = 2 }) {
  const share = `I get remote jobs that hire Nigerians in my inbox every morning, checked for scams. Free for ${ctx.trialDays} days: ${refLink}`;
  const n = joined % perReward;
  return `<div class="card invite"><b>🎁 Invite ${perReward} friends, get a month free</b>
<div class="bar"><i style="width:${Math.round((n / perReward) * 100)}%"></i></div>
<p class="small" style="margin:0">${n} of ${perReward} friends joined${joined >= perReward ? ` &middot; ${Math.floor(joined / perReward)} free month${joined >= 2 * perReward ? "s" : ""} earned` : ""}</p>
<div class="actions"><a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(share)}">Invite on WhatsApp</a></div>
<p class="small" style="margin:10px 0 0;overflow-wrap:anywhere">Or share your link: <a href="${esc(refLink)}">${esc(refLink)}</a></p></div>`;
}

export function welcome(ctx, { title = "You're in! 🎉", until, trial = true, sub, soon = false, refLink, joined = 0 }) {
  return page(ctx, `<div class="hero">${ART_ROCKET}<h1>${esc(title)}</h1><p>Your jobs are on their way.</p>
<span class="pill">${trial ? "Free trial" : "Active"} until ${esc(until)}</span></div>
<div class="card">${steps([
    ["done", "Email confirmed", "You're all set"],
    ["now", "Searching for your jobs", "Remote and local job boards, checked for scams and dead links"],
    ["", "First matches in your inbox", soon ? "In a few minutes, then every morning" : "Tomorrow morning, and every morning after"],
  ])}
<div class="actions"><a class="btn ghost" href="/manage/${esc(sub.token)}">Change my preferences</a></div></div>
${invite(ctx, { refLink, joined })}
${ctx.fromEmail ? `<p class="note">📌 Add <b>${esc(ctx.fromEmail)}</b> to your contacts so your jobs don't land in spam.</p>` : ""}`);
}

export function checkInbox(ctx, email) {
  return page(ctx, `<div class="hero">${ART_MAIL}<h1>Check your inbox 📬</h1>
<p>We've sent a link to <b>${esc(email)}</b>.<br>Tap it and your jobs are on their way.</p></div>
<div class="card">${steps([
    ["done", "Signed up", "Your preferences are saved"],
    ["now", "Confirm your email", "Open the email from JobAlert and tap the button"],
    ["", "Get matched jobs", "Every morning, checked for scams and never repeated"],
  ])}</div>
<p class="note">Can't find it? Check Spam or Promotions${ctx.fromEmail ? `. It comes from <b>${esc(ctx.fromEmail)}</b>` : ""}.</p>`);
}

// Someone signed up again with an address that's already confirmed: nothing changes, and the
// manage link goes to their inbox, so only the address owner can change or pay.
export function welcomeBack(ctx, email) {
  return page(ctx, `<div class="hero">${ART_MAIL}<h1>Welcome back 👋</h1>
<p><b>${esc(email)}</b> is already signed up, so we didn't change anything.</p></div>
<div class="card"><p style="margin:0">We've emailed you a link to <b>manage your job alerts</b>. Open it to change your job titles,
location or level${ctx.paidService ? `, or to pay ${esc(ctx.price)} for ${ctx.months} months` : ""}.</p></div>
<p class="note">Can't find it? Check Spam or Promotions${ctx.fromEmail ? `. It comes from <b>${esc(ctx.fromEmail)}</b>` : ""}.</p>`);
}

// Why JobAlert: the three strengths, near the top of the home page.
const ICONS = {
  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>`,
  inbox: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 13h4.5l1 2h5l1-2H20"/><path d="M9.5 9.5l1.8 1.8 3.4-3.6"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/><path d="M8.8 12.2l2.2 2.2 4.3-4.6"/></svg>`,
};

function strengths() {
  const item = (icon, color, title, text) =>
    `<div class="card"><span class="ico ${color}">${ICONS[icon]}</span><div><h3>${title}</h3><p>${text}</p></div></div>`;
  return `<section class="why" aria-label="Why JobAlert">
  ${item("globe", "blue", "Foreign jobs that accept Nigerians",
    "Remote roles from companies abroad, often paying in dollars or pounds. We check every one is open to applicants in Nigeria.")}
  ${item("inbox", "gold", "Done for you, every morning",
    "No scrolling through huge job boards. A short, matched list lands in your inbox each morning, and you never see the same job twice.")}
  ${item("shield", "green", "Scams and dead links filtered out",
    "We drop listings that ask you to pay, push you to WhatsApp or Telegram, or point to jobs that have closed.")}
</section>`;
}

// JobAlert vs doing it yourself (no named competitors: fair to everyone, and true).
function compare() {
  const row = (what, us, them) => `<tr><td>${what}</td><td class="us">✓ ${us}</td><td class="them">${them}</td></tr>`;
  return `<section class="vs card"><h2>Why not just search job boards?</h2><table><colgroup><col class="a"><col class="b"><col></colgroup>
<tr><th></th><th>JobAlert</th><th>On your own</th></tr>
${row("Remote jobs from abroad", "Every morning", "Mostly local listings")}
${row("Open to Nigerians?", "Checked for you", "Find out after applying")}
${row("Scams and closed jobs", "Filtered out", "Common, especially in WhatsApp groups")}
${row("Effort", "Read one email", "Hours of scrolling")}
${row("Repeats", "Never", "Same posts again and again")}
</table></section>`;
}

// "What you get": free trial vs member, shown under the sign-up form.
function plans(ctx) {
  const li = (text, yes = true) => `<li${yes ? "" : ' class="no"'}>${text}</li>`;
  return `<section class="plans" id="plans"><h2>What you get</h2>
<div class="card plan"><h3>Free trial</h3><p class="cost"><b>₦0</b> for ${ctx.trialDays} days, no card</p><ul>
  ${li("Up to <b>5 jobs</b> every morning")}
  ${li("Searches your first <b>2 job titles</b>")}
  ${li("Remote jobs, or on-site near you")}
  ${li("Checked for scams, dead links and jobs you can't apply for from your country")}
  ${li("Never the same job twice")}
  ${li("Telegram alerts during the day", false)}
</ul></div>
<div class="card plan best"><span class="tag">BEST VALUE</span><h3>Member</h3><p class="cost">${ctx.paidService
    ? `<b>${esc(ctx.price)}</b> for ${ctx.months} months, paid once`
    : "<b>Coming soon</b>"}</p><ul>
  ${li("Up to <b>10 jobs</b> every morning")}
  ${li("Searches all <b>5 job titles</b>")}
  ${li("<b>Telegram alerts</b> 4 times a day, so you apply first")}
  ${li("<b>Your CV tailored</b> to any job, plus an <b>AI cover letter</b>")}
  ${li("Everything in the free trial")}
  ${li("No auto-renewal; we remind you before it ends")}
  ${li("Full refund within 7 days if it's not for you")}
</ul></div></section>`;
}

const sel = (cond) => (cond ? " selected" : "");
const chk = (cond) => (cond ? " checked" : "");

// The plan card at the top of the manage page: where they stand, time left, and the pay button.
export function membershipCard(ctx, sub, member, now = new Date()) {
  const until = sub.paid_until ? new Date(sub.paid_until) : null;
  const active = Boolean(until && until > now);
  const daysLeft = active ? Math.ceil((until - now) / 86400000) : 0;
  const date = until ? until.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
  const [kind, badge] = !active ? ["off", "Not active"] : member ? ["member", "Member"] : ["trial", "Free trial"];
  const headline = !active ? (until ? `Ended on ${date}` : "No jobs being sent")
    : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
  const sub2 = !active ? "Join to start getting matched jobs every morning again." : `Active until ${date}`;
  // Bar: share of one paid period (or the trial) still left, so it visibly runs down.
  const span = member ? Math.max(daysLeft, ctx.months * 30) : ctx.trialDays;
  const pct = active ? Math.max(4, Math.min(100, Math.round((daysLeft / span) * 100))) : 0;
  const cta = !active ? "Reactivate my alerts" : member ? "Add 3 more months" : "Become a member";
  return `<section class="plan ${kind}">
  <div class="plan-top"><span class="badge">${badge}</span><span class="plan-price">${esc(ctx.price)} <small>/ ${ctx.months} months</small></span></div>
  <p class="plan-head">${esc(headline)}</p>
  <p class="plan-sub">${esc(sub2)}</p>
  ${active ? `<div class="meter" role="progressbar" aria-label="Time left" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>` : ""}
  <a class="plan-cta" href="/pay/${esc(sub.token)}">${esc(cta)} <span aria-hidden="true">→</span></a>
  <p class="plan-note">${member || active ? "Added on top of your current time · " : ""}One payment · No auto-renewal · Secure checkout by ${esc(ctx.provider)}</p>
</section>`;
}

export function form(ctx, { sub = null, action, button, heading, lead, status = "", member = false, telegramLink = null,
  ref = "", inviteBox = "" }) {
  const onsite = sub && !sub.remote_only;
  const words = String(sub?.keywords || "").split(",").map((w) => w.trim()).filter(Boolean);
  const listed = (w) => JOBS.find((j) => j.toLowerCase() === w.toLowerCase());
  const picked = words.map(listed).filter(Boolean);
  const other = words.filter((w) => !listed(w)).join(", ");
  // Home page: only the headline and a short form; everything else waits behind "See what you get".
  const statusBox = !sub || !status ? "" : ctx.paidService ? membershipCard(ctx, sub, member)
    : `<p class="card status">${esc(status)}</p>`;
  const telegramBox = !telegramLink ? "" : `<p class="card status">${sub.telegram_chat_id
    ? "Telegram alerts are on: new matches arrive there during the day. Send /stop to the bot to turn them off."
    : `Get new matches on Telegram during the day, before the morning email. <a href="${esc(telegramLink)}">Connect Telegram</a>`}</p>`;
  const intro = sub ? `<h1>${esc(heading)}</h1>
<p class="lead">${esc(lead)}</p>` : `<div class="home"><h1>Remote jobs that <em>actually hire Nigerians</em></h1>
<p class="lead">${esc(lead)}</p></div>`;
  return page(ctx, `${intro}
${statusBox}${telegramBox}
<form class="card" method="post" action="${esc(action)}" id="prefs">
  ${sub ? "" : `<label for="email">Your email</label>
  <input id="email" name="email" type="email" required maxlength="320" placeholder="you@example.com">`}
  <label id="jobs_label">What jobs do you want? <span class="hint">Pick up to 5${sub && !member ? ". The free trial searches the first 2" : ""}</span></label>
  <details class="pick" id="jobs"><summary class="${picked.length || other ? "" : "empty"}" aria-labelledby="jobs_label">${
    esc([...picked, other].filter(Boolean).join(", ") || "Choose jobs")}</summary>
  <div class="opts">
    ${JOBS.map((j, i) => `<div class="row"><input id="job${i}" name="job" type="checkbox" value="${esc(j)}"${chk(picked.includes(j))}>
      <label for="job${i}">${esc(j)}</label></div>`).join("\n    ")}
    <label for="other">Something else <span class="hint">Separate with commas</span></label>
    <input id="other" name="other" type="text" maxlength="200" placeholder="e.g. public relations" value="${esc(other)}">
  </div></details>
  <label for="country">Where do you live?</label>
  <select id="country" name="country">
    <option value="">Anywhere / don't filter</option>
    ${COUNTRIES.map((c) => `<option value="${esc(c)}"${sel(sub?.country === c)}>${esc(c)}</option>`).join("")}
  </select>
  <details class="fold more"${onsite || (sub && sub.level !== "entry") ? " open" : ""}><summary>More options</summary>
  <fieldset>
    <legend>How do you want to work?</legend>
    <div class="row"><input id="wt_remote" name="work_type" type="radio" value="remote"${chk(!onsite)}>
      <label for="wt_remote" style="margin:0">Remote <span class="hint">(work from anywhere)</span></label></div>
    <div class="row"><input id="wt_onsite" name="work_type" type="radio" value="onsite"${chk(onsite)}>
      <label for="wt_onsite" style="margin:0">On-site or hybrid</label></div>
  </fieldset>
  <div id="city_box"${onsite ? "" : " hidden"}>
    <label for="city">Preferred city or area <span class="hint">We'll look for jobs near here, plus remote ones</span></label>
    <input id="city" name="city" type="text" maxlength="120" placeholder="e.g. Lagos, Manchester" value="${esc(sub?.city)}">
  </div>
  <label for="level">Experience level</label>
  <select id="level" name="level">
    <option value="any"${sel(sub?.level === "any")}>Any level</option>
    <option value="entry"${sel(!sub || sub.level === "entry")}>Entry level / junior</option>
    <option value="mid"${sel(sub?.level === "mid")}>Mid level (no director/head roles)</option>
  </select>
  </details>
  <input class="hp" name="website" tabindex="-1" autocomplete="off">${ref ? `
  <input type="hidden" name="ref" value="${esc(ref)}">` : ""}
  <button type="submit" id="submit">${esc(button)}</button>
  ${sub ? "" : `<p class="free">${ctx.trialDays} days free &middot; no card</p>`}
</form>
<details class="fold info" id="plans"><summary>${sub ? "How it works" : "See what you get"}</summary>
${sub ? "" : strengths() + plans(ctx) + compare()}
  ${ctx.paidService && !sub ? `<p class="small"><b>Free for ${ctx.trialDays} days, then ${esc(ctx.price)} for ${ctx.months} months</b>, paid once through ${esc(ctx.provider)} if you want to continue. Nothing renews automatically. <a href="/terms">Terms and refunds</a>.</p>` : ""}
  <p class="small">One email a day with up to ${member ? "10" : "5"} new matches, only on days we find some${member ? "" : ctx.paidService ? " (members get up to 10, plus Telegram alerts)" : ""}. Remote jobs that only hire from certain countries are left out if yours isn't one of them. We skip senior roles if you choose a lower level, and we filter out unpaid roles and listings with common scam signs. Every email has a one-click unsubscribe link. We only store your email and these preferences, never share them, and delete them when you unsubscribe.</p>
</details>
${inviteBox}
${sub ? `<p class="small"><a href="/unsubscribe/${esc(sub.token)}">Unsubscribe and delete my details</a></p>` : ""}
<script>
  (function () {
    var form = document.getElementById("prefs"), box = document.getElementById("city_box"), city = document.getElementById("city");
    function sync() {
      var onsite = document.getElementById("wt_onsite").checked;
      box.hidden = !onsite;
      city.required = onsite;
    }
    if (location.hash === "#plans") document.getElementById("plans").open = true;
    form.addEventListener("change", sync);
    sync();
    var jobs = document.getElementById("jobs"), boxes = jobs.querySelectorAll("input[type=checkbox]"),
        other = document.getElementById("other"), label = jobs.querySelector("summary");
    function chosen() {
      var list = [];
      boxes.forEach(function (b) { if (b.checked) list.push(b.value); });
      other.value.split(",").forEach(function (w) { if (w.trim()) list.push(w.trim()); });
      return list;
    }
    function syncJobs() {
      var list = chosen();
      label.textContent = list.length ? list.join(", ") : "Choose jobs";
      label.className = list.length ? "" : "empty";
      boxes.forEach(function (b) { b.disabled = !b.checked && list.length >= 5; });
      other.setCustomValidity(list.length > 5 ? "Pick up to 5 jobs" : "");
    }
    jobs.addEventListener("input", syncJobs);
    syncJobs();
    form.addEventListener("submit", function (e) {
      if (!chosen().length) {
        e.preventDefault();
        jobs.open = true;
        other.setCustomValidity("Pick at least one job, or type your own");
        other.reportValidity();
        other.setCustomValidity("");
        return;
      }
      var b = document.getElementById("submit");
      b.disabled = true;
      b.textContent = "Sending...";
    });
  })();
</script>`);
}

export function pay(ctx, { sub, heading, status }) {
  return page(ctx, `<h1>${esc(heading)}</h1>
<p class="lead">Alerts for ${esc(sub.email)}${status ? `. ${esc(status)}` : ""}</p>
<form class="card" method="post" action="/pay/${esc(sub.token)}" id="payform">
  <p class="price"><b>${esc(ctx.price)}</b> for ${ctx.months} months</p>
  <ul class="perks">
    <li>Up to 10 new matches a day across all 5 of your job titles (the trial gets 5 jobs from 2 titles)</li>
    <li>New matches on Telegram during the day, so you can apply first</li>
    <li>${sub.remote_only ? "Remote jobs" : `Jobs near ${esc(sub.city)}, plus remote ones`}, checked for scams and dead links</li>
    <li>One payment. Nothing renews automatically; we'll email you before it ends</li>
  </ul>
  <button type="submit" id="paybtn">Pay ${esc(ctx.price)} securely with ${esc(ctx.provider)}</button>
  <p class="small">You'll pay on ${esc(ctx.provider)}'s secure page by card or bank transfer. We never see your card details.
    See our <a href="/terms">terms and refund policy</a>.</p>
</form>
<p class="small"><a href="/manage/${esc(sub.token)}">Change my preferences</a> &middot;
  <a href="/unsubscribe/${esc(sub.token)}">Unsubscribe and delete my details</a></p>
<script>
  document.getElementById("payform").addEventListener("submit", function () {
    var b = document.getElementById("paybtn"); b.disabled = true; b.textContent = "Opening ${esc(ctx.provider)}...";
  });
</script>`);
}

export function terms(ctx) {
  return page(ctx, `<h1>Terms, pricing and refunds</h1>
<div class="card">
  <p><b>What you get.</b> ${esc(ctx.siteName)} emails you up to 5 new job listings a day that match the job titles, location and
    experience level you choose. We search public job boards and filter out listings that look unpaid, expired or like scams,
    but we don't employ anyone, can't guarantee a job, and you should always read a listing yourself before applying.</p>
  <p><b>Free trial.</b> Everyone gets ${ctx.trialDays} days of alerts free when they confirm their email. No card needed.</p>
  ${ctx.paidService ? `<p><b>Price.</b> ${esc(ctx.price)} for ${ctx.months} months, paid once through ${esc(ctx.provider)}. It does not renew automatically; we email
    you before it ends with a link to renew if you want to.</p>
  <p><b>Refunds.</b> If you're not happy within 7 days of paying, email us and we'll refund you in full. After that, payments
    aren't refundable, but you can stop the emails any time.</p>` : ""}
  <p><b>Your data.</b> We store your email, your preferences, a record of your payments and, if you use cover letters or tailored CVs,
    the CV you paste. Your CV is only used to write your letters and tailored CVs (it's sent to our AI provider, Anthropic, for that).
    We never share your details otherwise, and unsubscribing deletes your email, preferences and CV (payment records
    are kept for accounting).</p>
  ${ctx.contact ? `<p><b>Contact.</b> <a href="mailto:${esc(ctx.contact)}">${esc(ctx.contact)}</a></p>` : ""}
</div>
<p class="small"><a href="/">Back to sign-up</a></p>`);
}

export { COUNTRIES };

// Remote roles foreign companies most often hire for from abroad; anything else goes in "Something else".
export const JOBS = ["Virtual assistant", "Customer support", "Software developer", "Data analyst", "Content writer",
  "Social media manager", "Graphic designer", "Digital marketing", "Project manager", "Bookkeeper"];

// AI cover letter or tailored CV for one job (members). Shows the result once written, and the form to (re)write it.
// The tailored CV can also be downloaded as a Word file, built in the browser from the text.
export function letterPage(ctx, { kind = "letter", sub, job, hasCv, cv = "", letter = "", left, error = "" }) {
  const isCv = kind === "cv";
  const noun = isCv ? "CV" : "letter";
  const cvField = `<label for="cv">Your CV <span class="hint">Paste the text once; we'll remember it</span></label>
  <textarea id="cv" name="cv" rows="8" maxlength="15000"${hasCv ? "" : " required"} placeholder="Paste your CV here">${esc(cv)}</textarea>`;
  const other = `/${isCv ? "letter" : "cv"}/${sub.token}?${new URLSearchParams({ t: job.title, c: job.company, u: job.url })}`;
  const fileName = `CV - ${job.title}${job.company ? ` - ${job.company}` : ""}`.replace(/[^\w .,&()-]+/g, " ").slice(0, 120);
  return page(ctx, `<h1>${isCv ? "📄 Your CV for this job" : "✍️ Cover letter"}</h1>
<p class="lead">${esc(job.title)}${job.company ? ` at ${esc(job.company)}` : ""}</p>
${isCv && !letter ? `<p>We rewrite your CV for this job: a summary aimed at the role, your most relevant experience first,
and the advert's own words where they're true of you. Nothing is made up.</p>` : ""}
${error ? `<p class="card status">${esc(error)}</p>` : ""}
${letter ? `<div class="card"><textarea id="letter" rows="${isCv ? 24 : 16}" readonly>${esc(letter)}</textarea>
<div class="actions"><button type="button" id="copy" style="margin:0">Copy ${noun}</button>
${isCv ? `<button type="button" id="word" class="btn ghost" style="margin:0">Download for Word</button>` : ""}
${job.url ? `<a class="btn ghost" href="${esc(job.url)}">Open the job and apply</a>` : ""}</div>
<p class="note">${isCv ? "Check every line is true and your contact details are right before sending."
    : "Read it through and add one detail only you know before sending."}
<a href="${esc(other)}">${isCv ? "Write a cover letter for it too" : "Get your CV tailored to this job too"}</a></p></div>
<script>document.getElementById("copy").onclick=function(){var t=document.getElementById("letter");t.select();
navigator.clipboard?navigator.clipboard.writeText(t.value):document.execCommand("copy");this.textContent="Copied ✓";};
${isCv ? `document.getElementById("word").onclick=function(){
var e=function(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");},out=[],list=false;
document.getElementById("letter").value.split("\\n").forEach(function(l,i){var t=l.trim();
if(/^[-•*] /.test(t)){if(!list){out.push("<ul>");list=true;}out.push("<li>"+e(t.slice(2))+"</li>");return;}
if(list){out.push("</ul>");list=false;}if(!t)return;
if(i===0)out.push("<h1>"+e(t)+"</h1>");else if(t.length<40&&t===t.toUpperCase()&&/[A-Z]/.test(t))out.push("<h2>"+e(t)+"</h2>");else out.push("<p>"+e(t)+"</p>");});
if(list)out.push("</ul>");
var doc="<html><head><meta charset='utf-8'><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt}h1{font-size:18pt;margin:0}h2{font-size:12pt;border-bottom:1px solid #999;margin:14pt 0 4pt}p,li{margin:2pt 0}</style></head><body>"+out.join("")+"</body></html>";
var a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\\ufeff"+doc],{type:"application/msword"}));
a.download=${JSON.stringify(fileName + ".doc").replace(/</g, "\\u003c")};document.body.appendChild(a);a.click();a.remove();};` : ""}</script>` : ""}
<form class="card" method="post" id="write"${letter ? ' style="margin-top:16px"' : ""}>
  ${hasCv ? `<details class="fold more" style="margin-top:0"><summary>Update my CV</summary>${cvField}</details>` : cvField}
  <button type="submit" id="go">${letter ? "Write it again" : isCv ? "Tailor my CV" : "Write my cover letter"}</button>
  <p class="free">${left} of 10 left today</p>
</form>
<script>document.getElementById("write").addEventListener("submit",function(){var b=document.getElementById("go");b.disabled=true;b.textContent="Writing... (about ${isCv ? 40 : 20} seconds)";});</script>`);
}
