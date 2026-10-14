// Job Alerts sign-up website as a Cloudflare Worker (replaces job_alerts/app.py on
// Render: Workers don't sleep). People sign up, confirm by email, pay, and can
// change or cancel their alerts. The daily search and emails still run from GitHub
// Actions (job_alerts/send_daily.py) against the same Neon database.
//
// Secrets/vars: DATABASE_URL, BREVO_API_KEY, FROM_EMAIL, CONTACT_EMAIL, and the
// payment keys in payments.js. Optional: BASE_URL, SITE_NAME, PRICE_NGN, PERIOD_DAYS.
import { neon } from "@neondatabase/serverless";
import * as db from "./db.js";
import * as mail from "./mail.js";
import * as payments from "./payments.js";
import * as views from "./views.js";
import * as assets from "./assets.js";
import * as telegram from "./telegram.js";

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
    months: Math.round(payments.periodDays(env) / 30),
    trialDays: payments.trialDays(env),
    contact: (env.CONTACT_EMAIL || env.FROM_EMAIL || "").trim(),
    fromEmail: (env.FROM_EMAIL || "").trim(),
  };
}

const html = (body, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

// Validates the form. Remote is the default; on-site/hybrid needs a preferred city or area.
export function cleanPrefs(f) {
  const words = String(f.get("keywords") || "").split(",").map((w) => w.trim()).filter(Boolean).slice(0, 5);
  const remote = f.get("work_type") !== "onsite";
  const city = remote ? "" : String(f.get("city") || "").split(/\s+/).filter(Boolean).join(" ").slice(0, 120);
  if (!words.length || words.some((w) => w.length > 60) || (!remote && !city)) return null;
  const country = String(f.get("country") || "");
  const level = String(f.get("level") || "any");
  return {
    keywords: words.join(", "), country: views.COUNTRIES.includes(country) ? country : "",
    level: ["any", "entry", "mid"].includes(level) ? level : "any", remote_only: remote, city,
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
  const msg = (heading, text, opts = {}) => html(views.message(ctx, { heading, text, ...opts }), opts.status || 200);
  const notFound = () => msg("Link not recognised", "This link is invalid or you've already unsubscribed.", { status: 404 });
  let m;

  if (path === "/healthz") return Response.json({ ok: true });

  if (path === "/" && method === "GET") {
    let stats = {};
    try {
      const s = await db.stats(q, ctx.paidService);
      stats = Object.fromEntries(Object.entries(s).filter(([, n]) => n >= 10)); // only once worth showing; never made up
    } catch (e) {
      console.log(`[stats] ${e}`);
    }
    return html(views.form(ctx, { action: "/subscribe", button: "Send me jobs", heading: "Remote jobs that actually hire Nigerians", stats,
      lead: "Jobs from companies abroad, checked as open to Nigeria and free of scams, in your inbox every morning. Prefer on-site? Tell us where." }));
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
      letter = mail.confirmation(ctx.baseUrl, sub.token);
    }
    try {
      await mail.send(env, sub.email, ...letter);
    } catch (e) {
      console.log(`[confirm email] failed for subscriber ${sub.id}: ${e}`);
      return msg("We couldn't send your email", "Please try again in a few minutes.", { status: 502 });
    }
    return html(views.checkInbox(ctx, sub.email));
  }

  if ((m = path.match(/^\/confirm\/([\w-]+)$/)) && method === "GET") {
    let sub = await db.confirm(q, m[1]);
    if (!sub) return notFound();
    if (!sub.paid_until) sub = await db.startTrial(q, sub.id, ctx.trialDays);
    if (!db.isPaid(sub)) { // trial (or paid time) already used up
      if (ctx.paidService) return html(views.pay(ctx, { sub, heading: "Email confirmed. Pick up where you left off", status: status(ctx, sub) }));
      return msg("Email confirmed", "Your free trial has ended. We'll email you when paid plans open.");
    }
    return html(views.welcome(ctx, { sub, until: fmtDate(sub.paid_until), trial: !(await db.isMember(q, sub)) }));
  }

  if ((m = path.match(/^\/manage\/([\w-]+)$/))) {
    const sub = await db.byToken(q, m[1]);
    if (method === "GET") {
      if (!sub) return notFound();
      const member = await db.isMember(q, sub);
      const bot = member ? await telegram.botUsername(env) : null;
      return html(views.form(ctx, { sub, action: `/manage/${sub.token}`, button: "Save", heading: "Your job alerts",
        lead: `Alerts for ${sub.email}`, status: status(ctx, sub), member,
        telegramLink: bot ? `https://t.me/${bot}?start=${sub.token}` : null }));
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
        const checkout = await payments.startCheckout(env, sub.email, sub.id, `${ctx.baseUrl}/paid`);
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
      sub = await applyPayment(env, q, ref);
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
      if (ref) await applyPayment(env, q, ref);
    } catch (e) {
      console.log(`[webhook] ${e}`);
    }
    return new Response("ok");
  }

  if (path === "/terms" && method === "GET") return html(views.terms(ctx));

  return msg("Page not found", "There's nothing at this address.", { link: "/", linkText: "Go to sign-up", status: 404 });
}

async function applyPayment(env, q, ref) {
  const paid = await payments.verify(env, ref);
  return paid ? db.recordPayment(q, paid.reference, paid.subscriberId, paid.amount, payments.periodDays(env)) : null;
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
};
