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
  .seo h1 { margin:6px 0 6px; } .seo .lead { color:var(--muted); margin:0 0 16px; }
  .seo .updated { font-size:.8rem; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:#ff9f1c; }
  .sjob { display:block; text-decoration:none; color:inherit; border:1px solid var(--border); border-radius:14px; padding:13px 15px; margin-bottom:10px; background:var(--card); }
  .sjob b { display:block; color:var(--accent); } .sjob span { color:var(--muted); font-size:.88rem; }
  .jcta { margin:20px 0; border:2px solid #ffc75a; border-radius:16px; padding:16px; background:color-mix(in srgb, #ffc75a 8%, var(--card)); }
  .jcta b { display:block; font-size:1.1rem; color:var(--text); } .jcta p { margin:6px 0 12px; color:var(--muted); font-weight:400; }
  .jcta a { display:block; text-align:center; text-decoration:none; padding:14px; border-radius:12px; background:#ffc75a; color:#1b2440; font-weight:800; }
  .cats { display:flex; flex-wrap:wrap; gap:8px; margin:10px 0 18px; padding:0; list-style:none; }
  .cats a { display:inline-block; text-decoration:none; border:1px solid var(--border); border-radius:99px; padding:7px 13px; font-size:.9rem; font-weight:600; background:var(--card); }
  .advert { white-space:pre-line; font-size:.95rem; line-height:1.55; }
  .apply { display:block; text-align:center; text-decoration:none; margin:16px 0; padding:15px; border-radius:14px; background:var(--accent); color:var(--on-accent); font-weight:800; }
  .ok-note { color:var(--ok); font-weight:700; }
</style>`;

function cta(ctx) {
  return `<div class="jcta"><b>Get jobs like these every morning</b>
<p>Pick your job titles. Every morning we email you new remote jobs that accept Nigerians, checked for scams.</p>
<a href="/">Start free for ${ctx.trialDays} days</a></div>`;
}

const jobLink = (j) => `<a class="sjob" href="/remote-jobs/job/${esc(j.key)}"><b>${esc(j.title)}</b><span>${
  esc([j.company, j.location, `posted ${day(j.posted)}`].filter(Boolean).join(" · "))}</span></a>`;

const catLinks = (list, current = "") => `<ul class="cats">${CATEGORIES.filter(([s]) => s !== current)
  .map(([slug, name]) => [slug, name, inCategory(slug, list).length]).filter(([, , n]) => n)
  .map(([slug, name, n]) => `<li><a href="/remote-jobs/${slug}">${esc(name[0].toUpperCase() + name.slice(1))} (${n})</a></li>`).join("")}</ul>`;

const head = (ctx, path) => `<link rel="canonical" href="${esc(ctx.baseUrl)}${esc(path)}">`;

export function indexPage(ctx, list, today = new Date()) {
  const latest = newestFirst(list).slice(0, 30);
  return page(ctx, `${STYLE}<div class="seo"><span class="updated">Updated ${day(today)}</span>
<h1>Remote jobs open to Nigerians</h1>
<p class="lead">${list.length} remote jobs from companies abroad that accept applicants in Nigeria, posted in the last ${DAYS} days. Every one is checked for scams.</p>
${catLinks(list)}${cta(ctx)}<h2>Newest jobs</h2>${latest.map(jobLink).join("")}${cta(ctx)}</div>`,
  { og: { title: "Remote jobs open to Nigerians | JobAlert", description: `${list.length} remote jobs that accept applicants in Nigeria, updated every morning.`, path: "/remote-jobs" },
    head: head(ctx, "/remote-jobs") });
}

export function categoryPage(ctx, slug, list, today = new Date()) {
  const name = NAME[slug];
  const mine = newestFirst(inCategory(slug, list));
  const title = `Remote ${name} jobs open to Nigerians`;
  return page(ctx, `${STYLE}<div class="seo"><span class="updated">Updated ${day(today)}</span>
<h1>${esc(title)}</h1>
<p class="lead">${mine.length ? `${mine.length} remote ${esc(name)} job${mine.length === 1 ? "" : "s"} from companies that accept applicants in Nigeria, posted in the last ${DAYS} days.` :
    `No ${esc(name)} jobs right now. New ones arrive every morning.`}</p>
${mine.map(jobLink).join("")}${cta(ctx)}<h2>Other remote jobs</h2>${catLinks(list, slug)}</div>`,
  { og: { title: `${title} | JobAlert`, description: `${mine.length} remote ${name} jobs that accept applicants in Nigeria, updated every morning.`, path: `/remote-jobs/${slug}` },
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
  return page(ctx, `${STYLE}<div class="seo"><span class="updated">Remote · open to Nigeria</span>
<h1>${esc(j.title)}</h1>
<p class="lead">${esc([j.company, j.location, j.pay, `posted ${day(j.posted)}`].filter(Boolean).join(" · "))}</p>
<p class="ok-note">✓ Open to applicants in Nigeria${j.eligibility_note ? `: ${esc(j.eligibility_note)}` : ""}</p>
<a class="apply" href="${esc(j.url)}" rel="nofollow noopener" target="_blank">Apply on the company's site</a>
${j.description ? `<div class="card advert">${esc(j.description)}</div>` : ""}
${cta(ctx)}${cat ? `<p><a href="/remote-jobs/${cat[0]}">More remote ${esc(cat[1])} jobs →</a></p>` : `<p><a href="/remote-jobs">More remote jobs →</a></p>`}</div>`,
  { og: { title: `${j.title}${j.company ? ` at ${j.company}` : ""} (remote, open to Nigeria) | JobAlert`,
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
