// Job Alerts sign-up website as a Cloudflare Worker (replaces job_alerts/app.py on
// Render: Workers don't sleep). People sign up, confirm by email, pay, and can
// change or cancel their alerts. The daily search and emails still run from GitHub
// Actions (job_alerts/send_daily.py) against the same Neon database.
//
// Secrets/vars: DATABASE_URL, BREVO_API_KEY, FROM_EMAIL, CONTACT_EMAIL, and the
// payment keys in payments.js. ADMIN_KEY turns on the owner's dashboard at /admin. Optional: BASE_URL, SITE_NAME, PRICE_NGN, PERIOD_DAYS.
import { neon } from "@neondatabase/serverless";
import * as db from "./db.js";
import * as mail from "./mail.js";
import * as payments from "./payments.js";
import * as views from "./views.js";
import * as assets from "./assets.js";
import * as telegram from "./telegram.js";
import * as firstSearch from "./firstsearch.js";
import * as letters from "./letters.js";
import * as admin from "./admin.js";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function makeQuery(env) {
  const sql = neon(env.DATABASE_URL);
  return (text, params) => sql.query(text, params);
}

function context(env, request) {
  const prov = payments.provider(env);
  return {
    siteName: env.SITE_NAME || "JobAlert",
    baseUrl: (env.BASE_URL || new URL(request.url).origin).replace(/\/$/, ""),
    paidService: Boolean(prov),
    provider: prov,
    price: `₦${payments.priceNgn(env).toLocaleString("en")}`,
    priceNgn: payments.priceNgn(env),
    months: Math.round(payments.periodDays(env) / 30),
    trialDays: payments.trialDays(env),
    contact: (env.CONTACT_EMAIL || env.FROM_EMAIL || "").trim(),
    fromEmail: (env.FROM_EMAIL || "").trim(),
  };
}

const html = (body, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

// Validates the form. Remote is the default; on-site/hybrid needs a preferred city or area.
export function cleanPrefs(f) {
  // Ticked jobs from the list, then "Something else" (and the old free-text field, for forms still open).
  const typed = [f.get("other"), f.get("keywords")].map((v) => String(v || "")).join(",");
  const listed = f.getAll("job").map(String).filter((j) => views.JOBS.includes(j));
  const seen = new Set();
  const words = [...listed, ...typed.split(",").map((w) => w.trim()).filter(Boolean)]
    .filter((w) => !seen.has(w.toLowerCase()) && seen.add(w.toLowerCase())).slice(0, 5);
  const remote = f.get("work_type") !== "onsite";
  const city = remote ? "" : String(f.get("city") || "").split(/\s+/).filter(Boolean).join(" ").slice(0, 120);
  if (!words.length || words.some((w) => w.length > 60) || (!remote && !city)) return null;
  const country = String(f.get("country") || "");
  const level = String(f.get("level") || "any");
  const hours = String(f.get("hours") || "any");
  return {
    keywords: words.join(", "), country: views.COUNTRIES.includes(country) ? country : "",
    level: ["any", "entry", "mid"].includes(level) ? level : "any", remote_only: remote, city,
    hours: ["any", "full", "part"].includes(hours) ? hours : "any",
    heard: views.HEARD.includes(String(f.get("heard") || "")) ? String(f.get("heard")) : "",
  };
}

function status(ctx, sub) {
  if (db.isPaid(sub)) return `Active until ${fmtDate(sub.paid_until)}.`;
  if (!sub.confirmed) return "";
  return ctx.paidService ? "Not active. Pay to start receiving jobs." : "Your free trial has ended.";
}

const fmtDate = (d) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

// Logo, icons and the link-preview image (generated into assets.js by assets/make_assets.mjs).
const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const STATIC = {
  "/favicon.svg": ["image/svg+xml", () => assets.MARK_SVG],
  "/logo.svg": ["image/svg+xml", () => assets.LOGO_SVG],
  "/favicon.ico": ["image/png", () => bytes(assets.FAVICON_PNG)],
  "/favicon.png": ["image/png", () => bytes(assets.FAVICON_PNG)],
  "/apple-touch-icon.png": ["image/png", () => bytes(assets.ICON_PNG)],
  "/og.jpg": ["image/jpeg", () => bytes(assets.OG_JPG)],
};

export async function handle(request, env, q) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (STATIC[path]) {
    const [type, body] = STATIC[path];
    return new Response(body(), { headers: { "content-type": type, "cache-control": "public, max-age=86400" } });
  }
  const method = request.method;
  const ctx = context(env, request);
  // Launch offer: while fewer than LAUNCH_SPOTS people have paid, the price is the launch price everywhere.
  if (ctx.paidService && payments.launchSpots(env) > 0 && path !== "/healthz") {
    const left = payments.launchSpots(env) - (await db.payingMembers(q).catch(() => Infinity));
    if (left > 0) {
      Object.assign(ctx, { fullPrice: ctx.price, priceNgn: payments.launchPrice(env), launchLeft: left, launchSpots: payments.launchSpots(env),
        price: `₦${payments.launchPrice(env).toLocaleString("en")}` });
    }
  }
  const msg = (heading, text, opts = {}) => html(views.message(ctx, { heading, text, ...opts }), opts.status || 200);
  const notFound = () => msg("Link not recognised", "This link is invalid or you've already unsubscribed.", { status: 404 });
  const refLink = async (sub) => `${ctx.baseUrl}/?ref=${await db.refCode(q, sub)}`;
  let m;

  if (path === "/healthz") return Response.json({ ok: true });

  // Owner's dashboard: /admin asks for the password (ADMIN_KEY) once per browser; /admin/<key>
  // opens it directly. Without ADMIN_KEY, or with a wrong key in the link, it is "not found".
  if (path === "/admin" || path.startsWith("/admin/")) {
    const pageNotFound = () => msg("Page not found", "There's nothing at this address.", { link: "/", linkText: "Go to sign-up", status: 404 });
    if (!admin.enabled(env)) return pageNotFound();
    const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer", "x-frame-options": "DENY" };
    const dashboard = async (cookie) => new Response(admin.render(ctx.siteName, await admin.load(env, q)),
      { headers: cookie ? { ...headers, "set-cookie": await admin.sessionCookie(env) } : headers });
    if (path === "/admin" && method === "POST") {
      const f = await request.formData();
      if (await admin.allowed(env, f.get("key"))) return dashboard(true);
      return new Response(admin.loginPage(ctx.siteName, true), { status: 401, headers });
    }
    if (method !== "GET") return pageNotFound();
    if (path === "/admin") {
      return (await admin.loggedIn(env, request)) ? dashboard(false) : new Response(admin.loginPage(ctx.siteName), { headers });
    }
    let given = url.pathname.slice("/admin/".length).replace(/\/+$/, "");
    try { given = decodeURIComponent(given); } catch { /* keep it as typed */ }
    return (await admin.allowed(env, given)) ? dashboard(true) : pageNotFound();
  }

  if (path === "/" && method === "GET") {
    const ref = (url.searchParams.get("ref") || "").replace(/[^\w]/g, "").slice(0, 16);
    return html(views.form(ctx, { action: "/subscribe", button: "Send me jobs", heading: "Remote jobs that actually hire Nigerians",
      lead: "Checked, scam-free jobs from abroad, in your inbox every morning.", ref }));
  }

  if (path === "/subscribe" && method === "POST") {
    const f = await request.formData();
    if (f.get("website")) return msg("Thanks!", "Check your inbox to confirm."); // hidden field only bots fill in
    const email = String(f.get("email") || "").trim();
    const prefs = cleanPrefs(f);
    if (!EMAIL_RE.test(email) || email.length > 320 || !prefs) {
      return msg("Something's missing", "Please enter a valid email, at least one job title, and your preferred area if you chose on-site.",
        { link: "/", linkText: "Go back", status: 400 });
    }
    const existing = await db.byEmail(q, email);
    let sub, letter;
    if (existing?.confirmed) {
      // Don't let anyone who knows an address change its alerts: email the owner a manage link instead.
      sub = existing;
      letter = mail.manageLink(ctx.baseUrl, sub.token);
    } else {
      sub = await db.upsertSubscriber(q, email, prefs);
      const referrer = !existing && f.get("ref") ? await db.byRefCode(q, String(f.get("ref"))) : null;
      if (referrer) await db.setReferredBy(q, sub.id, referrer.id);
      letter = mail.confirmation(ctx.baseUrl, sub.token);
    }
    try {
      await mail.send(env, sub.email, ...letter);
    } catch (e) {
      console.log(`[confirm email] failed for subscriber ${sub.id}: ${e}`);
      return msg("We couldn't send your email", "Please try again in a few minutes.", { status: 502 });
    }
    return html(existing?.confirmed ? views.welcomeBack(ctx, sub.email) : views.checkInbox(ctx, sub.email));
  }

  if ((m = path.match(/^\/confirm\/([\w-]+)$/)) && method === "GET") {
    const before = await db.byToken(q, m[1]);
    let sub = await db.confirm(q, m[1]);
    if (!sub) return notFound();
    if (!sub.paid_until) sub = await db.startTrial(q, sub.id, ctx.trialDays);
    if (!db.isPaid(sub)) { // trial (or paid time) already used up
      if (ctx.paidService) return html(views.pay(ctx, { sub, heading: "Email confirmed. Pick up where you left off", status: status(ctx, sub) }));
      return msg("Email confirmed", "Your free trial has ended. We'll email you when paid plans open.");
    }
    // First confirmation only: start their first search now instead of waiting for the morning run.
    const soon = !before?.confirmed ? await firstSearch.start(env, sub.email) : false;
    return html(views.welcome(ctx, { sub, until: fmtDate(sub.paid_until), trial: !(await db.isMember(q, sub)), soon,
      refLink: await refLink(sub), joined: await db.confirmedReferrals(q, sub.id), paid: await db.paidReferrals(q, sub.id) }));
  }

  if ((m = path.match(/^\/manage\/([\w-]+)$/))) {
    const sub = await db.byToken(q, m[1]);
    if (method === "GET") {
      if (!sub) return notFound();
      const member = await db.isMember(q, sub);
      const bot = member ? await telegram.botUsername(env) : null;
      return html(views.form(ctx, { sub, action: `/manage/${sub.token}`, button: "Save", heading: "Your job alerts",
        lead: `Alerts for ${sub.email}`, status: status(ctx, sub), member,
        telegramLink: bot ? `https://t.me/${bot}?start=${sub.token}` : null,
        whatsapp: member && Boolean((env.WHATSAPP_PHONE_ID || "").trim()),
        inviteBox: views.invite(ctx, { refLink: await refLink(sub), joined: await db.confirmedReferrals(q, sub.id), paid: await db.paidReferrals(q, sub.id) }) }));
    }
    if (method === "POST") {
      const prefs = cleanPrefs(await request.formData());
      if (!sub || !prefs) {
        return msg("Couldn't save", "Please enter at least one job title, and your preferred area if you chose on-site.",
          { link: `/manage/${m[1]}`, linkText: "Go back", status: 400 });
      }
      await db.updatePrefs(q, sub.token, prefs);
      return msg("Saved", "Your new preferences apply from the next email.", { ok: true });
    }
  }

  // Members' WhatsApp number for instant alerts (sent by job_alerts/send_telegram.py); an empty number turns them off.
  if ((m = path.match(/^\/whatsapp\/([\w-]+)$/)) && method === "POST") {
    const sub = await db.byToken(q, m[1]);
    if (!sub) return notFound();
    if (!(await db.isMember(q, sub))) return msg("WhatsApp alerts are for members", "Join to get new matches on WhatsApp during the day.",
      ctx.paidService ? { link: `/pay/${sub.token}`, linkText: `Become a member for ${ctx.price}` } : {});
    const raw = String((await request.formData()).get("whatsapp") || "").trim();
    const number = whatsappNumber(raw, sub.country);
    if (raw && !number) {
      return msg("Check the number", "Please enter your WhatsApp number with its country code, like +234 803 123 4567.",
        { link: `/manage/${sub.token}`, linkText: "Go back", status: 400 });
    }
    await db.setWhatsapp(q, sub.token, number || null);
    return msg(number ? "WhatsApp alerts are on" : "WhatsApp alerts are off",
      number ? "New matches will come to WhatsApp during the day, before the morning email." : "Your daily email carries on as normal.",
      { ok: true, link: `/manage/${sub.token}`, linkText: "Back to my alerts" });
  }

  // AI cover letter, tailored CV or interview prep for one job, linked from members' emails and job pages:
  // /letter/<token>, /cv/<token> or /prep/<token>, with ?t=<title>&c=<company>&u=<job link>
  if ((m = path.match(/^\/(letter|cv|prep)\/([\w-]+)$/)) && (method === "GET" || method === "POST")) {
    const kind = m[1], what = { cv: "Tailored CVs", letter: "Cover letters", prep: "Interview prep sheets" }[kind];
    const noun = { cv: "new CV", letter: "letter", prep: "prep" }[kind], plural = { cv: "tailored CVs", letter: "letters", prep: "prep sheets" }[kind];
    const sub = await db.byToken(q, m[2]);
    if (!sub) return notFound();
    if (!letters.enabled(env)) return msg(`${what} aren't available yet`, "Please check back soon.");
    if (!(await db.isMember(q, sub))) {
      return msg(`${what} are for members`, "Members get a CV tailored to any job, an AI cover letter and interview prep in one click, plus 10 jobs a day and Telegram alerts.",
        ctx.paidService ? { link: `/pay/${sub.token}`, linkText: `Become a member for ${ctx.price}` } : {});
    }
    const p = url.searchParams;
    const jobUrl = String(p.get("u") || "");
    const job = { title: String(p.get("t") || "").slice(0, 200), company: String(p.get("c") || "").slice(0, 200),
                  url: /^https?:\/\//.test(jobUrl) ? jobUrl.slice(0, 1000) : "" };
    if (!job.title) return notFound();
    let cv = await db.getCv(q, sub.id);
    const used = await db.lettersToday(q, sub.id, kind);
    const render = (extra = {}) => html(views.letterPage(ctx, { kind, sub, job, hasCv: Boolean(cv), cv, left: Math.max(0, letters.PER_DAY - used), ...extra }));
    if (method === "GET") return render();

    const pasted = String((await request.formData()).get("cv") || "").trim();
    if (pasted) {
      cv = pasted.slice(0, letters.MAX_CV);
      await db.setCv(q, sub.id, cv);
    }
    if (!cv) return render({ error: `Paste your CV first, so the ${noun} can be about you.` });
    if (used >= letters.PER_DAY) return render({ error: `That's today's 10 ${plural}. You can write more tomorrow.` });
    let text = null;
    try {
      text = await letters.write(env, { cv, ...job, advert: job.url ? await letters.advertText(job.url) : "" }, kind);
    } catch (e) {
      console.log(`[${kind}] failed for subscriber ${sub.id}: ${e}`);
    }
    if (!text) return render({ error: "We couldn't write this one just now. Please try again in a minute." });
    await db.addLetter(q, sub.id, kind);
    if (job.url) await db.markClickedByUrl(q, sub.id, job.url); // a strong sign they're applying: ask about it tomorrow
    return render({ hasCv: true, letter: text, left: Math.max(0, letters.PER_DAY - used - 1) });
  }

  // Log in with an emailed link (no passwords): /login sends it, /signin/<code> turns it into a session cookie that lasts
  // 30 years. Browsers keep a cookie at most 400 days, so every visit to /login or /me while logged in renews it.
  const session = (request.headers.get("cookie") || "").match(/(?:^|;\s*)ja_session=([\w-]{20,64})/)?.[1];
  const me = async () => (session ? db.bySession(q, session) : null);
  const redirect = (to, headers = {}) => new Response(null, { status: 303, headers: { location: to, ...headers } });
  const sessionCookie = (value) => `ja_session=${value}; Path=/; Max-Age=${60 * 60 * 24 * db.COOKIE_DAYS}; HttpOnly; Secure; SameSite=Lax`;
  const stayLoggedIn = async () => {
    await db.renewSession(q, session);
    return { "set-cookie": sessionCookie(session) };
  };

  if (path === "/login") {
    if (method === "GET") return (await me()) ? redirect("/me", await stayLoggedIn()) : html(views.loginPage(ctx));
    if (method === "POST") {
      const email = String((await request.formData()).get("email") || "").trim();
      if (!EMAIL_RE.test(email) || email.length > 320) return html(views.loginPage(ctx, { error: "Please enter a valid email." }), 400);
      const sub = await db.byEmail(q, email);
      const code = sub?.confirmed ? await db.newLoginCode(q, sub.id) : null;
      if (code) {
        try {
          await mail.send(env, sub.email, ...mail.signInLink(ctx.baseUrl, code, db.LOGIN_LINK_MINUTES));
        } catch (e) {
          console.log(`[login email] failed for subscriber ${sub.id}: ${e}`);
          return msg("We couldn't send your email", "Please try again in a few minutes.", { link: "/login", linkText: "Try again", status: 502 });
        }
      }
      // The same answer either way, so the page doesn't reveal who has an account.
      return html(views.loginSent(ctx, email));
    }
  }

  // GET only shows a page that logs in with a POST, so mail apps that open links to check them don't use up the link.
  if ((m = path.match(/^\/signin\/([\w-]{20,64})$/)) && (method === "GET" || method === "POST")) {
    const expired = () => msg("This link has expired", "Log-in links work once, for 30 minutes. Ask for a new one.", { link: "/login", linkText: "Send me a new link", status: 410 });
    if (method === "GET") return (await db.loginCodeValid(q, m[1])) ? html(views.signinPage(ctx)) : expired();
    const value = await db.startSession(q, m[1]);
    if (!value) return expired();
    return redirect("/me", { "set-cookie": sessionCookie(value) });
  }

  if (path === "/logout" && method === "POST") {
    if (session) await db.endSession(q, session);
    return redirect("/", { "set-cookie": "ja_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" });
  }

  if (path === "/me" || path === "/me/cv") {
    const sub = await me();
    if (!sub) return redirect("/login");
    const member = await db.isMember(q, sub);
    if (path === "/me/cv") {
      if (method === "POST") {
        await db.setCv(q, sub.id, String((await request.formData()).get("cv") || "").trim().slice(0, letters.MAX_CV) || null);
        return redirect("/me?saved=cv");
      }
      return html(views.cvPage(ctx, { cv: await db.getCv(q, sub.id), member }));
    }
    if (method !== "GET") return notFound();
    const apps = member ? await db.applications(q, sub.id) : [];
    return html(views.memberHome(ctx, { sub, member, until: db.isPaid(sub) ? fmtDate(sub.paid_until) : "", jobs: await db.latestJobs(q, sub.id),
      applied: apps.filter((r) => r.status !== "not_yet").length, interviews: apps.filter((r) => ["interview", "offer"].includes(r.status)).length,
      hasCv: Boolean(await db.getCv(q, sub.id)), letters: member && letters.enabled(env), saved: url.searchParams.get("saved") }));
  }

  // A job's own page, linked from the morning email: the whole advert and how to apply, then one button to the employer.
  if ((m = path.match(/^\/j\/([\w-]+)\/(\d+)$/)) && method === "GET") {
    const sub = await db.byToken(q, m[1]);
    const job = sub && await db.sentJob(q, sub.id, Number(m[2]));
    if (!job || !/^https?:\/\//.test(job.url || "")) return notFound();
    const member = await db.isMember(q, sub);
    return html(views.jobPage(ctx, { sub, job, member, letters: member && letters.enabled(env) }));
  }

  // The Apply button (job page, tracker): notes that they opened the job, then forwards to the advert.
  if ((m = path.match(/^\/go\/([\w-]+)\/(\d+)$/)) && method === "GET") {
    const sub = await db.byToken(q, m[1]);
    const job = sub && await db.sentJob(q, sub.id, Number(m[2]));
    if (!job || !/^https?:\/\//.test(job.url || "")) return notFound();
    await db.markClicked(q, sub.id, job.id);
    return Response.redirect(job.url, 302);
  }

  // One-tap answers from the email ("Applied", "Not yet", "Not for me") and the tracker page's status buttons.
  // GET only shows a page that sends the answer, so mail apps that open links to check them don't answer for people.
  if ((m = path.match(/^\/job\/([\w-]+)\/(\d+)\/(\w+)$/)) && (method === "GET" || method === "POST")) {
    const sub = await db.byToken(q, m[1]);
    const job = sub && db.ANSWERS.includes(m[3]) && await db.sentJob(q, sub.id, Number(m[2]));
    if (!job) return notFound();
    if (method === "GET") return html(views.answerPage(ctx, { job, answer: m[3] }));
    await db.setJobStatus(q, sub.id, job.id, m[3]);
    return Response.redirect(`${ctx.baseUrl}/applications/${sub.token}?saved=${job.id}`, 303);
  }

  if ((m = path.match(/^\/applications\/([\w-]+)$/)) && method === "GET") {
    const sub = await db.byToken(q, m[1]);
    if (!sub) return notFound();
    if (!(await db.isMember(q, sub))) {
      return msg("Your applications are for members", "Members can track every job they apply to, plus get a CV tailored to each job and 10 jobs a day.",
        ctx.paidService ? { link: `/pay/${sub.token}`, linkText: `Become a member for ${ctx.price}` } : {});
    }
    return html(views.applications(ctx, { sub, rows: await db.applications(q, sub.id), saved: Number(url.searchParams.get("saved")) || 0, prep: letters.enabled(env) }));
  }

  if ((m = path.match(/^\/unsubscribe\/([\w-]+)$/)) && (method === "GET" || method === "POST")) {
    await db.remove(q, m[1]); // POST = one-click unsubscribe from mail apps
    return msg("Unsubscribed", "You won't get any more emails, and your details have been deleted.", { ok: true });
  }

  if ((m = path.match(/^\/pay\/([\w-]+)$/))) {
    const sub = await db.byToken(q, m[1]);
    if (!sub || !ctx.paidService) return notFound();
    if (method === "GET") {
      return html(views.pay(ctx, { sub, heading: sub.paid_until ? "Renew your job alerts" : "Start your job alerts", status: status(ctx, sub) }));
    }
    if (method === "POST") {
      try {
        const checkout = await payments.startCheckout(env, sub.email, sub.id, `${ctx.baseUrl}/paid`, ctx.priceNgn);
        return Response.redirect(checkout, 303);
      } catch (e) {
        console.log(`[checkout] subscriber ${sub.id}: ${e}`);
        return msg("Payment page unavailable", "Please try again in a few minutes.", { link: `/pay/${sub.token}`, linkText: "Try again", status: 502 });
      }
    }
  }

  if (path === "/paid" && method === "GET") {
    // Credo sends transRef; Paystack sends reference (and trxref).
    const ref = url.searchParams.get("transRef") || url.searchParams.get("reference") || url.searchParams.get("trxref") || "";
    let sub = null;
    try {
      sub = await applyPayment(env, q, ref, ctx);
    } catch (e) {
      console.log(`[paid] ${ref}: ${e}`);
    }
    if (!sub) {
      return msg("We couldn't confirm your payment yet",
        "If you were charged, it will show on your account within a few minutes and we'll email you. " +
        `Otherwise you can try again from the link in your email${ctx.contact ? ` or contact ${ctx.contact}` : ""}.`, { status: 402 });
    }
    return html(views.welcome(ctx, { sub, title: "Payment received 🎉", until: fmtDate(sub.paid_until), trial: false }));
  }

  if (path === "/telegram/webhook" && method === "POST") {
    if (!telegram.enabled(env)) return new Response("telegram off", { status: 404 });
    if (request.headers.get("x-telegram-bot-api-secret-token") !== (await telegram.webhookSecret(env))) {
      return new Response("forbidden", { status: 401 });
    }
    const update = await request.json().catch(() => ({}));
    const chat = update.message?.chat?.id;
    const text = String(update.message?.text || "").trim();
    if (!chat || update.message.chat.type !== "private") return new Response("ok");
    const start = text.match(/^\/start(?:@\w+)?\s+([\w-]{20,64})$/);
    let reply;
    if (start) {
      const sub = await db.setTelegram(q, start[1], String(chat));
      if (!sub) reply = "That link didn't work. Open your manage page from one of our emails and tap Connect Telegram again.";
      else if (await db.isMember(q, sub)) reply = `Connected! New matches for "${sub.keywords}" will come here during the day. Send /stop to turn this off.`;
      else reply = "Connected. Telegram alerts are for paying members, so they'll start as soon as you pay. Send /stop to disconnect.";
    } else if (/^\/stop\b/.test(text)) {
      await db.clearTelegram(q, String(chat));
      reply = "Telegram alerts are off. Your daily email carries on as normal.";
    } else {
      reply = "To get job alerts here, open your manage page from one of our emails and tap Connect Telegram.";
    }
    await telegram.send(env, chat, reply).catch((e) => console.log(`[telegram send] ${e}`));
    return new Response("ok");
  }

  if (path === "/payments/webhook" && method === "POST") {
    // The provider calls this on every successful charge, so a payment counts even if
    // the buyer closed the page before coming back. Each one is re-checked with the provider.
    if (!ctx.paidService) return new Response("payments off", { status: 404 });
    const body = await request.text();
    let ref;
    try {
      ref = await payments.webhookRef(env, body, request.headers);
    } catch (e) {
      return new Response(String(e.message || e), { status: e instanceof SyntaxError ? 400 : 401 });
    }
    try {
      if (ref) await applyPayment(env, q, ref, ctx);
    } catch (e) {
      console.log(`[webhook] ${e}`);
    }
    return new Response("ok");
  }

  if (path === "/terms" && method === "GET") return html(views.terms(ctx));

  return msg("Page not found", "There's nothing at this address.", { link: "/", linkText: "Go to sign-up", status: 404 });
}

// Gives the inviter any free months they've newly earned, and tells them by email.
async function rewardReferrer(env, q, ctx, referrerId) {
  const months = await db.rewardReferrer(q, referrerId);
  if (!months) return;
  const ref = await db.byId(q, referrerId);
  try {
    await mail.send(env, ref.email, ...mail.referralReward(ctx.baseUrl, ref.token, months, fmtDate(ref.paid_until)));
  } catch (e) {
    console.log(`[referral email] failed for subscriber ${referrerId}: ${e}`);
  }
}

async function applyPayment(env, q, ref, ctx) {
  const paid = await payments.verify(env, ref);
  if (!paid) return null;
  const sub = await db.recordPayment(q, paid.reference, paid.subscriberId, paid.amount, payments.periodDays(env));
  // A friend they invited just became a member: the inviter earns a free month.
  if (sub?.justPaid && sub.referred_by && paid.amount > 0) await rewardReferrer(env, q, ctx, sub.referred_by);
  if (sub?.justPaid) {
    // Our own receipt, once per payment, so the member hears from JobAlert rather than only the payment provider.
    try {
      await mail.send(env, sub.email, ...mail.paymentReceipt(ctx.baseUrl, sub.token, { amount: paid.amount, reference: paid.reference,
        paidOn: fmtDate(new Date()), until: fmtDate(sub.paid_until), months: ctx.months, provider: ctx.provider, contact: ctx.contact }));
    } catch (e) {
      console.log(`[receipt] ${paid.reference}: ${e}`);
    }
  }
  return sub;
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env, makeQuery(env));
    } catch (e) {
      console.log(`[error] ${request.method} ${new URL(request.url).pathname}: ${e.stack || e}`);
      return html("<h1>Something went wrong</h1><p>Please try again in a minute.</p>", 500);
    }
  },
  // Cron trigger (wrangler.toml): start the morning job emails on time.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(firstSearch.daily(env));
  },
};

// "+234 803 123 4567" or a Nigerian "0803 123 4567" -> "2348031234567" (WhatsApp wants digits, country code first).
export function whatsappNumber(raw, country = "") {
  const plus = String(raw || "").trim().startsWith("+") || String(raw || "").trim().startsWith("00");
  let d = String(raw || "").replace(/\D/g, "").replace(/^00/, "");
  if (!d) return "";
  if (!plus && d.startsWith("0") && (country === "Nigeria" || !country) && d.length === 11) d = `234${d.slice(1)}`;
  return /^[1-9]\d{7,14}$/.test(d) ? d : "";
}

