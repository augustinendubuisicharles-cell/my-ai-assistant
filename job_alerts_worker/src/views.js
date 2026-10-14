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
  input[type=email], input[type=text], select { width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--text); font-size:1rem; }
  .row { display:flex; gap:10px; align-items:center; margin-top:14px; }
  button { margin-top:22px; width:100%; padding:12px; border:0; border-radius:8px; background:var(--accent); color:var(--on-accent); font-size:1rem; font-weight:600; cursor:pointer; }
  .hp { position:absolute; left:-9999px; }
  .ok { color:var(--ok); font-weight:600; }
  .small { font-size:.85rem; color:var(--muted); margin-top:18px; }
  a { color:var(--accent); }
  .status { padding:12px 16px; margin:0 0 16px; }
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
  .stats { list-style:none; padding:0; margin:0 0 20px; display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:10px; }
  .stats li { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:10px 12px; }
  .stats b { display:block; font-size:1.3rem; }
  .stats span { color:var(--muted); font-size:.85rem; }
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
  .brand { display:inline-flex; align-items:center; gap:10px; margin:0 0 20px; text-decoration:none; color:var(--text); font-size:1.35rem; font-weight:800; letter-spacing:-.3px; }
  .brand b { color:var(--accent); }
  .brand img { border-radius:9px; }
`;

const DESCRIPTION = "Remote and local jobs matched to you, checked for scams and never repeated, in your inbox every morning. 7 days free.";

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
<meta property="og:title" content="${esc(ctx.siteName)}: jobs in your inbox every morning">
<meta property="og:description" content="${esc(DESCRIPTION)}">
<meta property="og:url" content="${esc(ctx.baseUrl)}/">
<meta property="og:image" content="${esc(ctx.baseUrl)}/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(ctx.siteName)}: fresh remote and local jobs in your inbox every morning">
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
export function welcome(ctx, { title = "You're in! 🎉", until, trial = true, sub }) {
  const share = `I get job matches in my inbox every morning from JobAlert, checked for scams. ${trial ? `Free for ${ctx.trialDays} days: ` : ""}${ctx.baseUrl}`;
  return page(ctx, `<div class="hero">${ART_ROCKET}<h1>${esc(title)}</h1><p>Your jobs are on their way.</p>
<span class="pill">${trial ? "Free trial" : "Active"} until ${esc(until)}</span></div>
<div class="card">${steps([
    ["done", "Email confirmed", "You're all set"],
    ["now", "Searching for your jobs", "Remote and local job boards, checked for scams and dead links"],
    ["", "First matches in your inbox", "Tomorrow morning, and every morning after"],
  ])}
<div class="actions">
  <a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(share)}">Tell a friend on WhatsApp</a>
  <a class="btn ghost" href="/manage/${esc(sub.token)}">Change my preferences</a>
</div></div>
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

const sel = (cond) => (cond ? " selected" : "");
const chk = (cond) => (cond ? " checked" : "");

export function form(ctx, { sub = null, action, button, heading, lead, stats = {}, status = "", member = false, telegramLink = null }) {
  const onsite = sub && !sub.remote_only;
  const statTiles = sub ? "" : `<ul class="stats">
  ${stats.users ? `<li><b>${stats.users.toLocaleString("en")}</b><span>people getting alerts</span></li>` : ""}
  ${stats.jobs_30d ? `<li><b>${stats.jobs_30d.toLocaleString("en")}</b><span>jobs sent in the last 30 days</span></li>` : ""}
  <li><b>Daily</b><span>fresh matches every morning</span></li>
  <li><b>Checked</b><span>for scams and dead links</span></li>
  <li><b>${ctx.trialDays} days free</b><span>no card needed</span></li>
  ${ctx.paidService ? `<li><b>${esc(ctx.price)}</b><span>then ${ctx.months} months, no auto-renewal</span></li>` : ""}
</ul>`;
  const statusBox = sub && status ? `<p class="card status">${esc(status)}${
    ctx.paidService ? ` <a href="/pay/${esc(sub.token)}">Pay ${esc(ctx.price)} for ${ctx.months} months</a>` : ""}</p>` : "";
  const telegramBox = !telegramLink ? "" : `<p class="card status">${sub.telegram_chat_id
    ? "Telegram alerts are on: new matches arrive there during the day. Send /stop to the bot to turn them off."
    : `Get new matches on Telegram during the day, before the morning email. <a href="${esc(telegramLink)}">Connect Telegram</a>`}</p>`;
  return page(ctx, `<h1>${esc(heading)}</h1>
<p class="lead">${esc(lead)}</p>
${statusBox}${telegramBox}${statTiles}
<form class="card" method="post" action="${esc(action)}" id="prefs">
  ${sub ? "" : `<label for="email">Your email</label>
  <input id="email" name="email" type="email" required maxlength="320" placeholder="you@example.com">`}
  <label for="keywords">What jobs do you want? <span class="hint">Up to 5 job titles or skills, separated by commas${member ? "" : `. The free trial searches the first 2`}</span></label>
  <input id="keywords" name="keywords" type="text" required maxlength="200"
         placeholder="virtual assistant, public relations, customer support" value="${esc(sub?.keywords)}">
  <label for="country">Where do you live?</label>
  <select id="country" name="country">
    <option value="">Anywhere / don't filter</option>
    ${COUNTRIES.map((c) => `<option value="${esc(c)}"${sel(sub?.country === c)}>${esc(c)}</option>`).join("")}
  </select>
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
  <input class="hp" name="website" tabindex="-1" autocomplete="off">
  <button type="submit" id="submit">${esc(button)}</button>
  ${ctx.paidService && !sub ? `<p class="small"><b>Free for ${ctx.trialDays} days, then ${esc(ctx.price)} for ${ctx.months} months</b>, paid once through ${esc(ctx.provider)} if you want to continue. Nothing renews automatically. <a href="/terms">Terms and refunds</a>.</p>` : ""}
  <p class="small">One email a day with up to ${member ? "10" : "5"} new matches, only on days we find some${member ? "" : ctx.paidService ? " (members get up to 10, plus Telegram alerts)" : ""}. Remote jobs that only hire from certain countries are left out if yours isn't one of them. We skip senior roles if you choose a lower level, and we filter out unpaid roles and listings with common scam signs. Every email has a one-click unsubscribe link. We only store your email and these preferences, never share them, and delete them when you unsubscribe.</p>
</form>
${sub ? `<p class="small"><a href="/unsubscribe/${esc(sub.token)}">Unsubscribe and delete my details</a></p>` : ""}
<script>
  (function () {
    var form = document.getElementById("prefs"), box = document.getElementById("city_box"), city = document.getElementById("city");
    function sync() {
      var onsite = document.getElementById("wt_onsite").checked;
      box.hidden = !onsite;
      city.required = onsite;
    }
    form.addEventListener("change", sync);
    sync();
    form.addEventListener("submit", function () {
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
  <p><b>Your data.</b> We store your email, your preferences and a record of your payments. We never share them, and
    unsubscribing deletes your email and preferences (payment records are kept for accounting).</p>
  ${ctx.contact ? `<p><b>Contact.</b> <a href="mailto:${esc(ctx.contact)}">${esc(ctx.contact)}</a></p>` : ""}
</div>
<p class="small"><a href="/">Back to sign-up</a></p>`);
}

export { COUNTRIES };
