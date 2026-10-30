// Public job pages for Google: /remote-jobs (all categories), /remote-jobs/<category> and /remote-jobs/job/<key>,
// plus /sitemap.xml and /robots.txt. The jobs are the ones the morning run sent in the last 14 days to people
// searching from Nigeria (or "Any country", which means Nigeria), so every one has passed the Nigeria check.
// Each job page carries Google for Jobs markup (schema.org JobPosting). Nothing here shows who was sent a job.
import { page, esc } from "./views.js";

export const DAYS = 14;  // older adverts are dropped from the pages and the sitemap

export const CATEGORIES = [
  ["customer-support", "customer support", /support|customer|success|service|help ?desk|call cent/i],
  ["virtual-assistant", "virtual assistant and admin", /assistant|admin|secretar|receptionist|office manager|operations (associate|coordinator)/i],
  ["data-entry", "data entry and AI training", /data entry|annotat|transcri|label+ing|moderat|ai (trainer|tutor)|rater|evaluator/i],
  ["software-developer", "software developer", /engineer|developer|software|front.?end|back.?end|full.?stack|devops|programmer|\bqa\b|tester/i],
  ["data-analyst", "data analyst", /data (analyst|scien)|analytics|business intelligence|\bbi\b|insights analyst/i],
  ["marketing", "marketing", /marketing|\bseo\b|social media|growth|brand|community manager|content (manager|strateg|creator)/i],
  ["sales", "sales", /sales|account executive|business development|\bsdr\b|\bbdr\b|account manager|partnerships/i],
  ["design", "design", /design|\bux\b|\bui\b|illustrat|graphic|animat|video editor/i],
  ["writing", "writing and editing", /writer|writing|editor|copywrit|proofread|translat/i],
  ["finance-accounting", "finance and accounting", /account(ant|ing)|financ|bookkeep|payroll|\btax\b|audit|controller/i],
  ["hr-recruiting", "HR and recruiting", /recruit|talent|\bhr\b|human resources|people (partner|operations)/i],
  ["project-management", "project and product management", /project manager|program manager|product (manager|owner)|scrum|delivery manager|project coordinator/i],
];
const NAME = Object.fromEntries(CATEGORIES.map(([slug, name]) => [slug, name]));

// One row per advert (the newest time it was sent), with a short stable key for its public page.
export async function jobs(q) {
  return q(`SELECT DISTINCT ON (j.url) left(md5(j.url), 12) AS key, j.title, j.company, j.url, j.location, j.pay, j.matched,
      j.description, j.eligibility_note, coalesce(j.posted_at, j.sent_at) AS posted
    FROM sent_jobs j JOIN subscribers s ON s.id = j.subscriber_id
    WHERE j.sent_at > now() - interval '${DAYS} days' AND s.country IN ('', 'Nigeria') AND j.url ~ '^https?://'
      AND coalesce(j.eligibility, '') <> 'low'
    ORDER BY j.url, j.sent_at DESC`);
}

export const inCategory = (slug, list) => {
  const re = CATEGORIES.find(([s]) => s === slug)?.[2];
  return re ? list.filter((j) => re.test(j.title || "")) : [];
};
const newestFirst = (list) => [...list].sort((a, b) => new Date(b.posted) - new Date(a.posted));
const day = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const iso = (d) => new Date(d).toISOString();

const STYLE = `<style>
  .seo-hero { padding-bottom:44px; }
  .seo-hero .hero-copy h1 { font-size:clamp(2.3rem, 5vw, 3.9rem); max-width:13em; margin:16px 0 12px; }
  .seo-hero .hero-copy > p { margin-bottom:22px; }
  .seo-hero .narrow { max-width:820px; }
  .cats { display:flex; flex-wrap:wrap; gap:10px; margin:0; padding:0; list-style:none; }
  .cats a { display:inline-flex; align-items:center; gap:8px; text-decoration:none; color:#fff; font-weight:700; font-size:.95rem; padding:10px 16px; border-radius:99px;
    background:#ffffff1f; border:1px solid #ffffff40; backdrop-filter:blur(6px); transition:background .15s, transform .15s; }
  .cats a:hover { background:#ffffff33; transform:translateY(-2px); }
  .cats a b { font-size:.78rem; background:#ff8a1c; color:#fff; border-radius:99px; padding:1px 8px; }
  .cats.light a { color:#1450d8; background:#fff; border-color:var(--border); box-shadow:0 8px 20px -14px #0b1a3a66; }
  .seo-body { max-width:820px; margin:-26px auto 0; padding:0 24px 40px; position:relative; }
  .seo-body h2 { font-size:1.6rem; letter-spacing:-.03em; margin:34px 0 14px; font-weight:800; }
  .sj { display:grid; grid-template-columns:52px 1fr auto; gap:14px; align-items:center; text-decoration:none; background:#fff; color:#0b1a3a; border-radius:18px;
    padding:16px 18px; margin-bottom:12px; box-shadow:0 18px 36px -24px #021a5ab3; border:1px solid #e6ebf5; transition:transform .15s, box-shadow .15s; }
  .sj:hover { transform:translateY(-3px); box-shadow:0 24px 40px -22px #021a5ab3; }
  .sj .av { width:52px; height:52px; border-radius:14px; display:grid; place-items:center; font-weight:800; color:#fff; font-size:1.05rem; }
  .sj h3 { margin:0; font-size:1.05rem; color:#1450d8; letter-spacing:-.01em; }
  .sj small { display:block; color:#4a5672; font-weight:600; margin-top:2px; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
  .chips span { font-size:.76rem; font-weight:600; color:#4a5672; background:#f1f4fa; border-radius:8px; padding:3px 8px; }
  .chips span.pay { color:#127a3e; background:#e7f6ed; } .chips span.ng { color:#b85a00; background:#fff1e3; }
  .sj .when { font-size:.78rem; color:#7a8499; align-self:end; white-space:nowrap; }
  .jcta { margin:28px 0; border-radius:22px; padding:24px; color:#fff; background:linear-gradient(150deg, #151b2b, #222a3d); box-shadow:0 30px 60px -30px #021a5a99; }
  .jcta b { display:block; font-size:1.4rem; letter-spacing:-.02em; } .jcta p { margin:6px 0 16px; color:#c5cde0; }
  .jcta a { display:block; text-align:center; text-decoration:none; padding:15px; border-radius:14px; background:linear-gradient(135deg, #ff9f1c, #ff7a10); color:#fff; font-weight:800; font-size:1.05rem;
    box-shadow:0 14px 28px -14px #ff7a10; }
  .jcta small { display:block; text-align:center; margin-top:10px; color:#9aa5bd; }
  .apply { display:inline-block; text-decoration:none; padding:15px 26px; border-radius:14px; background:#fff; color:#1450d8; font-weight:800; font-size:1.05rem; box-shadow:0 18px 30px -16px #021a5a; }
  .hero-copy .chips span { background:#ffffff22; color:#fff; } .hero-copy .chips span.ng { background:#ff8a1c; color:#fff; } .hero-copy .chips span.pay { background:#22b45a; color:#fff; }
  .seo-hero .who { color:#e6efff; font-weight:700; font-size:1.1rem; margin:0 0 4px; }
  .okline { margin:18px 0 22px; color:#e6efff; font-size:.95rem; } .okline b { color:#fff; }
  .advert { background:#fff; border-radius:18px; padding:22px; border:1px solid #e6ebf5; box-shadow:0 18px 36px -24px #021a5ab3; white-space:pre-line; line-height:1.6; color:#2a3348; }
  .more { font-weight:700; color:#1450d8; text-decoration:none; }
  @media (prefers-color-scheme: dark) { .sj, .advert { background:var(--card); color:var(--text); border-color:var(--border); } .sj h3, .more { color:#7aa2ff; }
    .sj small, .advert { color:var(--text); } .chips span { background:#ffffff14; color:var(--muted); } .cats.light a { background:var(--card); color:#7aa2ff; } }
  @media (max-width:640px) { .sj { grid-template-columns:44px 1fr; } .sj .av { width:44px; height:44px; } .sj .when { grid-column:2; align-self:start; } }
</style>`;

const COLORS = ["#111827", "#1f6bff", "#f04a4a", "#f59e0b", "#7c3aed", "#0ea5a4", "#ff7a10", "#22b45a"];
const initials = (s) => (String(s || "?").match(/[A-Za-z0-9]+/g) || ["?"]).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
const colorOf = (s) => COLORS[[...String(s || "")].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length];
const ago = (d, now = new Date()) => { const n = Math.max(0, Math.floor((now - new Date(d)) / 864e5)); return n === 0 ? "Today" : n === 1 ? "1 day ago" : `${n} days ago`; };
const hoursOf = (j) => /part-time/.test(j.matched || "") ? "Part time" : /full-time/.test(j.matched || "") ? "Full time" : "";
const chips = (j) => `<div class="chips"><span>Remote</span>${hoursOf(j) ? `<span>${hoursOf(j)}</span>` : ""}${
  j.pay ? `<span class="pay">${esc(j.pay)}</span>` : ""}<span class="ng">Open to Nigeria</span></div>`;

const cta = (ctx) => `<div class="jcta"><b>Get jobs like these every morning</b>
<p>Pick your job titles. We email you new remote jobs that accept Nigerians, checked for scams.</p>
<a href="/">Start free for ${ctx.trialDays} days</a><small>No card needed</small></div>`;

const jobLink = (j) => `<a class="sj" href="/remote-jobs/job/${esc(j.key)}"><span class="av" style="background:${colorOf(j.company || j.title)}">${esc(initials(j.company || j.title))}</span>
<div><h3>${esc(j.title)}</h3>${j.company ? `<small>${esc(j.company)}</small>` : ""}${chips(j)}</div><span class="when">${ago(j.posted)}</span></a>`;

const catLinks = (list, current = "", light = false) => `<ul class="cats${light ? " light" : ""}">${CATEGORIES.filter(([s]) => s !== current)
  .map(([slug, name]) => [slug, name, inCategory(slug, list).length]).filter(([, , n]) => n)
  .map(([slug, name, n]) => `<li><a href="/remote-jobs/${slug}">${esc(name[0].toUpperCase() + name.slice(1))} <b>${n}</b></a></li>`).join("")}</ul>`;

const head = (ctx, path) => `<link rel="canonical" href="${esc(ctx.baseUrl)}${esc(path)}">`;
const nav = `<nav class="wrap nav"><a class="brand" href="/"><img src="/favicon.svg" alt="" width="44" height="44"><span>Job<b>Alert</b></span></a>
<div class="navlinks"><a class="navplain" href="/remote-jobs">All jobs</a><a class="navlink" href="/login">Log in</a></div></nav>`;
const hero = (inner) => `${STYLE}<section class="hero-band seo-hero">${nav}<div class="wrap narrow"><div class="hero-copy">${inner}</div></div></section>`;

export function indexPage(ctx, list, today = new Date()) {
  const latest = newestFirst(list).slice(0, 30);
  return page(ctx, `${hero(`<span class="eyebrow"><i></i>Updated ${day(today)} · ${list.length} jobs</span>
<h1>Remote jobs open to Nigerians</h1>
<p>From companies abroad that accept applicants in Nigeria. Every one checked for scams.</p>${catLinks(list)}`)}
<div class="seo-body">${cta(ctx)}<h2>Newest jobs</h2>${latest.map(jobLink).join("")}${cta(ctx)}</div>`,
  { landing: true, og: { title: "Remote jobs open to Nigerians | JobAlert", description: `${list.length} remote jobs that accept applicants in Nigeria, updated every morning.`, path: "/remote-jobs" },
    head: head(ctx, "/remote-jobs") });
}

export function categoryPage(ctx, slug, list, today = new Date()) {
  const name = NAME[slug];
  const mine = newestFirst(inCategory(slug, list));
  const title = `Remote ${name} jobs open to Nigerians`;
  return page(ctx, `${hero(`<span class="eyebrow"><i></i>Updated ${day(today)} · ${mine.length} job${mine.length === 1 ? "" : "s"}</span>
<h1>${esc(title)}</h1>
<p>${mine.length ? `From companies that accept applicants in Nigeria, posted in the last ${DAYS} days.` : "None right now. New ones arrive every morning."}</p>`)}
<div class="seo-body">${mine.map(jobLink).join("")}${cta(ctx)}<h2>Other remote jobs</h2>${catLinks(list, slug, true)}</div>`,
  { landing: true, og: { title: `${title} | JobAlert`, description: `${mine.length} remote ${name} jobs that accept applicants in Nigeria, updated every morning.`, path: `/remote-jobs/${slug}` },
    head: head(ctx, `/remote-jobs/${slug}`) });
}

// Google for Jobs: https://developers.google.com/search/docs/appearance/structured-data/job-posting
export function jobPosting(j) {
  const posted = new Date(j.posted);
  const hours = String(j.matched || "");
  const data = {
    "@context": "https://schema.org/", "@type": "JobPosting",
    title: j.title, description: esc(j.description || j.title).replace(/\n/g, "<br>"),
    datePosted: iso(posted), validThrough: iso(new Date(posted.getTime() + 30 * 864e5)),
    hiringOrganization: { "@type": "Organization", name: j.company || "Confidential" },
    jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "Nigeria" },
    directApply: false,
  };
  if (/part-time/.test(hours)) data.employmentType = "PART_TIME";
  else if (/full-time/.test(hours)) data.employmentType = "FULL_TIME";
  // "</script>" inside an advert must not end the tag early.
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

export function jobPage(ctx, j) {
  const cat = CATEGORIES.find(([, , re]) => re.test(j.title || ""));
  return page(ctx, `${hero(`<span class="eyebrow"><i></i>Posted ${day(j.posted)}</span>
<h1>${esc(j.title)}</h1>
<p class="who">${esc([j.company, j.location].filter(Boolean).join(" · "))}</p>${chips(j)}
<p class="okline"><b>✓ Open to applicants in Nigeria.</b>${j.eligibility_note ? ` ${esc(j.eligibility_note)}` : ""}</p>
<a class="apply" href="${esc(j.url)}" rel="nofollow noopener" target="_blank">Apply on the company's site →</a>`)}
<div class="seo-body">${cta(ctx)}${j.description ? `<h2>About the job</h2><div class="advert">${esc(j.description)}</div>` : ""}
<p><a class="more" href="/remote-jobs${cat ? `/${cat[0]}` : ""}">More remote ${cat ? `${esc(cat[1])} ` : ""}jobs →</a></p></div>`,
  { landing: true, og: { title: `${j.title}${j.company ? ` at ${j.company}` : ""} (remote, open to Nigeria) | JobAlert`,
    description: `Remote ${j.title}${j.company ? ` job at ${j.company}` : ""}, open to applicants in Nigeria.`, path: `/remote-jobs/job/${j.key}` },
    head: head(ctx, `/remote-jobs/job/${j.key}`) + jobPosting(j) });
}

export function sitemap(ctx, list, today = new Date()) {
  const url = (path, lastmod) => `<url><loc>${esc(ctx.baseUrl)}${esc(path)}</loc><lastmod>${iso(lastmod).slice(0, 10)}</lastmod></url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[url("/", today), url("/remote-jobs", today), url("/terms", today),
  ...CATEGORIES.map(([slug]) => url(`/remote-jobs/${slug}`, today)),
  ...list.map((j) => url(`/remote-jobs/job/${j.key}`, j.posted))].join("\n")}
</urlset>`;
}

// Personal links (they carry a subscriber's token) stay out of search engines.
export const ROBOTS = (baseUrl) => `User-agent: *
Allow: /
Disallow: /admin
Disallow: /confirm/
Disallow: /found/
Disallow: /manage/
Disallow: /login/
Disallow: /signin/
Disallow: /pay/
Disallow: /paid
Disallow: /me
Disallow: /j/
Disallow: /go/
Disallow: /cv/
Disallow: /letter/
Disallow: /prep/
Disallow: /applications/
Disallow: /unsubscribe/
Disallow: /whatsapp/
Disallow: /telegram/

Sitemap: ${baseUrl}/sitemap.xml
`;
