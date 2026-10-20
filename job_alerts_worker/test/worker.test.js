// End-to-end tests of the Worker against an in-memory Postgres (PGlite) with the
// exact schema job_alerts/db.py creates, and with Brevo/Credo/Paystack faked.
// Run from job_alerts_worker/:  npm test   (needs python3 and the repo's Python deps)
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import * as admin from "../src/admin.js";
import * as views from "../src/views.js";
import worker, { handle, catchUpPayments, retryFirstSearches, isCheckupTick } from "../src/index.js";
import * as firstSearch from "../src/firstsearch.js";
import COUNTRIES from "../src/countries.js";

const repo = new URL("../../", import.meta.url).pathname;
const SCHEMA = execSync(`python3 -c "
import os; os.environ['DATABASE_URL'] = 'sqlite://'
from sqlalchemy.schema import CreateTable
from sqlalchemy.dialects import postgresql
from job_alerts import db
print(';'.join(str(CreateTable(t).compile(dialect=postgresql.dialect())) for t in db.metadata.sorted_tables) + ';')
"`, { cwd: repo }).toString();

let pg, q, sent, txs, env, tg, gh, ai;
const BASE = "https://job-alerts.example.workers.dev";

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(SCHEMA);
  q = async (text, params = []) => (await pg.query(text, params)).rows;
  sent = [];
  txs = {};
  tg = [];
  gh = [];
  ai = [];
  env = { BREVO_API_KEY: "brevo", FROM_EMAIL: "hi@jobs.test", CREDO_PUBLIC_KEY: "0PUBkey", CREDO_SECRET_KEY: "secret", LAUNCH_SPOTS: "0" };
  globalThis.fetch = fakeFetch;
});

async function fakeFetch(url, init = {}) {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : null;
  if (u.startsWith("https://api.brevo.com/")) {
    sent.push(body);
    return Response.json({ messageId: "x" }, { status: 201 });
  }
  if (u === "https://api.credodemo.com/transaction/initialize") {
    assert.equal(init.headers.Authorization, "0PUBkey");
    const transRef = `vs_${Object.keys(txs).length + 1}`;
    txs[transRef] = body;
    return Response.json({ status: 200, data: { authorizationUrl: `https://pay.credodemo.com/${transRef}`, reference: body.reference } });
  }
  let m = u.match(/^https:\/\/api\.credodemo\.com\/transaction\/(.+)\/verify$/);
  if (m) {
    assert.equal(init.headers.Authorization, "secret");
    const tx = txs[decodeURIComponent(m[1])];
    if (!tx) return Response.json({ status: 404, message: "not found" }, { status: 404 });
    return Response.json({ status: 200, data: { status: 0, currencyCode: "NGN", transAmount: tx.amount, businessRef: tx.reference } });
  }
  if (u === "https://api.paystack.co/transaction/initialize") {
    txs[body.reference] = body;
    return Response.json({ status: true, data: { authorization_url: "https://checkout.paystack.com/x" } });
  }
  if (u.startsWith("https://api.paystack.co/transaction?status=success")) {
    return Response.json({ status: true, data: [...Object.values(txs).map((t) => ({ reference: t.reference })), { reference: "T_not_ours" }] });
  }
  m = u.match(/^https:\/\/api\.paystack\.co\/transaction\/verify\/(.+)$/);
  if (m) {
    const tx = txs[decodeURIComponent(m[1])];
    if (!tx) return Response.json({ status: false }, { status: 404 });
    return Response.json({ status: true, data: { status: "success", currency: "NGN", amount: tx.amount, reference: tx.reference } });
  }
  m = u.match(/^https:\/\/api\.telegram\.org\/botTGTOKEN\/(\w+)$/);
  if (m) {
    tg.push({ method: m[1], ...body });
    return Response.json({ ok: true, result: m[1] === "getMe" ? { username: "JobAlertTestBot" } : {} });
  }
  m = u.match(/^https:\/\/api\.github\.com\/repos\/owner\/repo\/actions\/workflows\/(job_alerts_daily|job_alerts_health)\.yml\/dispatches$/);
  if (m) {
    assert.equal(init.headers.authorization, "Bearer GHTOKEN");
    gh.push(m[1] === "job_alerts_daily" ? body : { workflow: m[1], ...body });
    return new Response(null, { status: 204 });
  }
  if (u.startsWith("https://api.github.com/repos/owner/repo/actions/workflows/job_alerts_daily.yml/runs")) {
    return Response.json({ workflow_runs: [
      { status: "completed", conclusion: "failure", event: "pull_request", run_started_at: new Date().toISOString(), html_url: "https://github.com/pr-check" },
      { status: "completed", conclusion: "success", event: "workflow_dispatch",
      run_started_at: new Date().toISOString(), html_url: "https://github.com/owner/repo/actions/runs/1" }] });
  }
  if (u === "https://api.anthropic.com/v1/messages?beta=true" || u === "https://api.anthropic.com/v1/messages") {
    ai.push(body);
    return Response.json({ id: "msg_1", type: "message", role: "assistant", model: body.model, stop_reason: "end_turn",
      content: [{ type: "text", text: "Dear Hiring Manager,\n\nI would love to join Acme." }],
      usage: { input_tokens: 10, output_tokens: 10 } });
  }
  if (u === "https://jobs.example/pr-1") {
    return new Response("<html><body><h1>PR Associate</h1><script>x()</script><p>Write press releases.</p></body></html>",
      { headers: { "content-type": "text/html" } });
  }
  if (u.startsWith("https://blocked.example/")) {  // like Himalayas and Jooble's sites: a bot wall, no advert
    return new Response("<html><title>Just a moment...</title></html>", { status: 403, headers: { "content-type": "text/html" } });
  }
  throw new Error(`unexpected fetch ${u}`);
}

const call = (path, { method = "GET", form, body, headers } = {}) =>
  handle(new Request(BASE + path, {
    method, headers, redirect: "manual",
    body: form ? new URLSearchParams(form) : body,
  }), env, q);

const signUp = (extra = {}) => call("/subscribe", { method: "POST",
  form: { email: "Ada@Example.com", keywords: "virtual assistant, pr, sales, marketing, editor", country: "Nigeria", level: "entry", ...extra } });
const subscriber = async () => (await q("SELECT * FROM subscribers"))[0];

test("the first members pay the launch price, and the page counts the places left", async () => {
  env.LAUNCH_SPOTS = "2";
  const home = await (await call("/")).text();
  assert.match(home, /<b>₦3,500<\/b> <s>₦5,000<\/s>/);
  assert.match(home, /2 places left/);

  await signUp();
  const { token } = await subscriber();
  await call(`/confirm/${token}`);
  await call(`/pay/${token}`, { method: "POST" });
  assert.equal(Object.values(txs).at(-1).amount, 350000); // kobo
  await call("/paid?transRef=vs_1");
  assert.equal((await q("SELECT amount_ngn FROM payments"))[0].amount_ngn, 3500);
  assert.match(await (await call("/")).text(), /1 place left/);

  // A ₦0 grant doesn't use a place; the second real payment ends the offer.
  await q("INSERT INTO payments (reference, subscriber_id, amount_ngn, paid_at) VALUES ('grant1', NULL, 0, now())");
  assert.match(await (await call("/")).text(), /1 place left/);
  await call("/subscribe", { method: "POST", form: { email: "b@example.com", keywords: "pr, sales, marketing, editor, writer" } });
  const second = (await q("SELECT id FROM subscribers WHERE email = 'b@example.com'"))[0].id;
  await q(`INSERT INTO payments (reference, subscriber_id, amount_ngn, paid_at) VALUES ('p2', ${second}, 3500, now())`);
  const after = await (await call("/")).text();
  assert.match(after, /<b>₦5,000<\/b> for/);
  assert.doesNotMatch(after, /places? left/);
});

test("new sign-ups can say how they heard about us, and the dashboard counts it", async () => {
  assert.match(await (await call("/")).text(), /How did you hear about us\?[\s\S]*<option>TikTok<\/option>/);
  await signUp({ heard: "TikTok" });
  assert.equal((await subscriber()).heard, "TikTok");
  await signUp({ heard: "Instagram" }); // signing up again doesn't change the first answer
  assert.equal((await subscriber()).heard, "TikTok");
  await call("/subscribe", { method: "POST", form: { email: "b@example.com", keywords: "pr, sales, marketing, editor, writer", heard: "<script>" } });
  assert.equal((await q("SELECT heard FROM subscribers WHERE email = 'b@example.com'"))[0].heard, null);
});

test("countries match the Python list", () => {
  const py = JSON.parse(execSync(`python3 -c "import json; from job_alerts.search import COUNTRIES; print(json.dumps(list(COUNTRIES)))"`,
    { cwd: repo, env: { ...process.env, DATABASE_URL: "sqlite://" } }).toString());
  assert.deepEqual(COUNTRIES, py);
});

test("home page shows the trial, the price and the form", async () => {
  const r = await call("/");
  const page = await r.text();
  assert.equal(r.status, 200);
  assert.match(page, /What you get/);
  assert.match(page, /<b>3 jobs<\/b>[\s\S]*<b>₦5,000<\/b> for 3 months[\s\S]*<b>5 best jobs<\/b>/);
  assert.match(page, /₦5,000/);
  assert.match(page, /7 days free/);
  // Sign-up is four cards: jobs, country, experience, then email last.
  assert.match(page, /Pick 5 jobs you'd do[\s\S]*Where do you live\?[\s\S]*How much experience\?[\s\S]*Where should we send your jobs\?/);
  assert.match(page, /action="\/subscribe"/);
  assert.match(page, /Is this real\?[\s\S]*₦5,000 for 3 months\. Nothing renews automatically/);
  assert.doesNotMatch(page, /people getting alerts/); // no counts until there are 10+
});

test("sign up stores preferences and emails a confirmation link", async () => {
  const r = await signUp();
  assert.equal(r.status, 200);
  const s = await subscriber();
  assert.equal(s.email, "ada@example.com");
  assert.equal(s.remote_only, true);
  assert.equal(s.confirmed, false);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].textContent.includes(`${BASE}/confirm/${s.token}`));
});

test("on-site needs a city; bots and bad input are refused", async () => {
  assert.equal((await signUp({ work_type: "onsite", city: "  " })).status, 400);
  assert.equal((await signUp({ email: "nope" })).status, 400);
  assert.equal((await signUp({ website: "spam" })).status, 200);
  assert.equal((await q("SELECT * FROM subscribers")).length, 0);
  await signUp({ work_type: "onsite", city: "  Lagos   Island " });
  const s = await subscriber();
  assert.equal(s.remote_only, false);
  assert.equal(s.city, "Lagos Island");
});

test("a confirmed address can't be changed by someone else signing up again", async () => {
  await signUp();
  await call(`/confirm/${(await subscriber()).token}`);
  const r = await signUp({ keywords: "hacker, a, b, c, d" });
  assert.equal((await subscriber()).keywords, "virtual assistant, pr, sales, marketing, editor");
  assert.match(sent.at(-1).subject, /Change your job alerts/);
  assert.match(sent.at(-1).htmlContent, /renew your membership/);
  // They're recognised: a welcome-back page, not the new-user "confirm your email" steps.
  const page = await r.text();
  assert.match(page, /Welcome back/);
  assert.match(page, /ada@example\.com<\/b> is already signed up/);
  assert.ok(!page.includes("Confirm your email"));
});

test("a new address gets the confirm-your-email page", async () => {
  const page = await (await signUp()).text();
  assert.match(page, /Confirm your email/);
  assert.ok(!page.includes("Welcome back"));
});

test("confirming starts a 7-day free trial, once", async () => {
  await signUp();
  const { token } = await subscriber();
  assert.match(await (await call(`/confirm/${token}`)).text(), /Free trial until .*2026/);
  const first = (await subscriber()).paid_until;
  const days = (new Date(first) - Date.now()) / 86400000;
  assert.ok(days > 6.9 && days < 7.1, `trial days ${days}`);
  await call(`/confirm/${token}`);
  assert.equal(String((await subscriber()).paid_until), String(first));
  assert.match(await (await call(`/manage/${token}`)).text(), /Active until/);
});

test("trial then pay with Credo -> 90 days added on top, counted once", async () => {
  await signUp();
  const { token } = await subscriber();
  await call(`/confirm/${token}`);
  assert.match(await (await call(`/pay/${token}`)).text(), /Pay ₦5,000 securely with Credo/);

  const r = await call(`/pay/${token}`, { method: "POST" });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "https://pay.credodemo.com/vs_1");
  assert.equal(txs.vs_1.amount, 500000);
  assert.equal(txs.vs_1.bearer, 1);

  const before = sent.length;
  const done = await call("/paid?transRef=vs_1");
  assert.equal(done.status, 303);  // straight to the members' dashboard, logged in
  assert.equal(done.headers.get("location"), "/me?saved=paid");
  assert.match(done.headers.get("set-cookie"), /ja_session=/);
  const s = await subscriber();
  const receipts = () => sent.slice(before).filter((m) => m.subject.startsWith("Payment received"));
  assert.equal(receipts().length, 1);
  assert.match(receipts()[0].htmlContent, /₦5,000/);
  assert.match(receipts()[0].htmlContent, new RegExp(`/login/${token}"[^>]*>Open my dashboard`));
  assert.equal(receipts()[0].sender.name, "JobAlert");
  const days = (new Date(s.paid_until) - Date.now()) / 86400000;
  assert.ok(days > 96.9 && days < 97.1, `paid days ${days}`);

  // The webhook reports the same payment: valid signature, but no double count.
  const body = JSON.stringify({ event: "transaction.successful", data: { transRef: "vs_1", businessCode: "700607001" } });
  const sig = createHash("sha512").update("secret700607001").digest("hex");
  assert.equal((await call("/payments/webhook", { method: "POST", body, headers: { "x-credo-signature": sig } })).status, 200);
  assert.equal(String((await subscriber()).paid_until), String(s.paid_until));
  assert.equal((await q("SELECT count(*)::int AS n FROM payments"))[0].n, 1);
  assert.equal(receipts().length, 1); // one receipt, even though the payment was reported twice

  const manage = await (await call(`/manage/${token}`)).text();
  assert.match(manage, /Active until/);
  assert.match(manage, /class="plan member"/);
  assert.match(manage, /9\d days left/);
  assert.match(manage, new RegExp(`href="/pay/${token}">Add 3 more months`));
});

test("the plan card shows trial, member and ended states", () => {
  const ctx = { price: "₦5,000", months: 3, trialDays: 7, provider: "Paystack" };
  const now = new Date("2026-10-14T12:00:00Z");
  const trial = views.membershipCard(ctx, { token: "t", paid_until: "2026-10-17T12:00:00Z" }, false, now);
  assert.match(trial, /Free trial/);
  assert.match(trial, /3 days left/);
  assert.match(trial, /Become a member/);
  const ended = views.membershipCard(ctx, { token: "t", paid_until: "2026-10-01T00:00:00Z" }, false, now);
  assert.match(ended, /Not active/);
  assert.match(ended, /Ended on 1 Oct 2026/);
  assert.match(ended, /Reactivate my alerts/);
  assert.ok(!ended.includes("progressbar"));
});

test("forged or unknown payments don't count", async () => {
  await signUp();
  const { token } = await subscriber();
  assert.equal((await call("/paid?transRef=vs_404")).status, 402);
  const body = JSON.stringify({ event: "transaction.successful", data: { transRef: "vs_1", businessCode: "1" } });
  assert.equal((await call("/payments/webhook", { method: "POST", body, headers: { "x-credo-signature": "f00" } })).status, 401);
  assert.equal((await subscriber()).paid_until, null);
  assert.ok(token);
});

test("renewing adds 90 days on top of the time left", async () => {
  await signUp();
  const { token } = await subscriber();
  await call(`/pay/${token}`, { method: "POST" });
  await call("/paid?transRef=vs_1");
  await call(`/pay/${token}`, { method: "POST" });
  await call("/paid?transRef=vs_2");
  const days = (new Date((await subscriber()).paid_until) - Date.now()) / 86400000;
  assert.ok(days > 179.9 && days < 180.1, `paid days ${days}`);
});

test("Paystack works when only its key is set", async () => {
  env = { BREVO_API_KEY: "b", FROM_EMAIL: "hi@jobs.test", PAYSTACK_SECRET_KEY: "sk_test_x" };
  await signUp();
  const { token } = await subscriber();
  await call(`/confirm/${token}`);
  const r = await call(`/pay/${token}`, { method: "POST" });
  assert.equal(r.headers.get("location"), "https://checkout.paystack.com/x");
  const ref = Object.keys(txs)[0];
  const body = JSON.stringify({ event: "charge.success", data: { reference: ref } });
  const sig = createHmac("sha512", "sk_test_x").update(body).digest("hex");
  assert.equal((await call("/payments/webhook", { method: "POST", body, headers: { "x-paystack-signature": sig } })).status, 200);
  assert.ok(new Date((await subscriber()).paid_until) > new Date());
});

test("a Paystack payment we never heard about is picked up by the 15-minute check", async () => {
  env = { BREVO_API_KEY: "b", FROM_EMAIL: "hi@jobs.test", PAYSTACK_SECRET_KEY: "sk_test_x" };
  await signUp();
  const { token } = await subscriber();
  await call(`/confirm/${token}`);
  await call(`/pay/${token}`, { method: "POST" }); // paid, but no return visit and no webhook
  const ref = Object.keys(txs)[0];
  const before = sent.length;
  assert.deepEqual(await catchUpPayments(env, q), [ref]);
  assert.equal((await q("SELECT reference FROM payments"))[0].reference, ref);
  const days = (new Date((await subscriber()).paid_until) - Date.now()) / 86400000;
  assert.ok(days > 96 && days < 98, `paid days ${days}`); // 90 days on top of the 7-day trial
  assert.equal(sent.length, before + 1); // our receipt
  assert.deepEqual(await catchUpPayments(env, q), []); // already recorded: nothing twice
  assert.equal(sent.length, before + 1);
});

test("a shared job page: details for all, how to apply after joining", async () => {
  const slug = "vibesmeet-integration-engineer";
  const locked = await (await call(`/job/${slug}`)).text();
  assert.match(locked, /Application Integration Engineer/);
  assert.match(locked, /og:title" content="Application Integration Engineer at VibesMeet/);
  assert.doesNotMatch(locked, /support@vibesmeet\.com/);
  assert.equal((await call("/job/nope")).status, 404);
  // Joining from the page: confirming opens the apply details.
  await call("/subscribe", { method: "POST", form: { email: "dev@example.com", job: "Software developer", work_type: "remote", for: slug } });
  const sub = await subscriber();
  assert.equal(sub.keywords, "Software developer, Mobile developer, Full stack developer, Frontend developer, Backend developer");
  assert.equal(sub.country, "Nigeria");
  assert.equal(sub.heard, "Job link");
  assert.match(sent.at(-1).htmlContent, new RegExp(`/confirm/${sub.token}\\?job=${slug}`));
  const r = await call(`/confirm/${sub.token}?job=${slug}`);
  assert.equal(r.headers.get("location"), `/job/${slug}?t=${sub.token}`);
  const open = await (await call(`/job/${slug}?t=${sub.token}`)).text();
  assert.match(open, /support@vibesmeet\.com/);
  assert.match(open, /mailto:support@vibesmeet\.com\?subject=Application%20Integration%20Engineer%20Application/);
  // Already a member: we email them the link instead of changing anything.
  const page = await (await call("/subscribe", { method: "POST", form: { email: "dev@example.com", job: "Software developer", work_type: "remote", for: slug } })).text();
  assert.match(page, /already a member/);
  assert.match(sent.at(-1).subject, /How to apply: Application Integration Engineer at VibesMeet/);
  assert.match(sent.at(-1).htmlContent, new RegExp(`/job/${slug}\\?t=${sub.token}`));
});

test("opening the confirm link twice at once starts only one first search", async () => {
  env.GH_TOKEN = "GHTOKEN";
  env.GITHUB_REPO = "owner/repo";
  await signUp();
  const { token } = await subscriber();
  await Promise.all([call(`/confirm/${token}`), call(`/confirm/${token}`)]);
  assert.equal(gh.filter((d) => d.inputs?.first === "1").length, 1);
});

test("without payment keys the site is free", async () => {
  env = { BREVO_API_KEY: "b", FROM_EMAIL: "hi@jobs.test" };
  const home = await (await call("/")).text();
  assert.match(home, /7 days free/);
  assert.doesNotMatch(home, /₦5,000/);
  await signUp();
  const { token } = await subscriber();
  assert.match(await (await call(`/confirm/${token}`)).text(), /You&#39;re in!/);
  assert.equal((await call(`/pay/${token}`)).status, 404);
});

test("preferences save, and unsubscribe deletes the subscriber but keeps payment records", async () => {
  await signUp();
  const { token } = await subscriber();
  await call(`/pay/${token}`, { method: "POST" });
  await call("/paid?transRef=vs_1");
  const r = await call(`/manage/${token}`, { method: "POST",
    form: { keywords: "data analyst", country: "Ghana", level: "mid", work_type: "onsite", city: "Accra" } });
  assert.equal(r.status, 200);
  const s = await subscriber();
  assert.deepEqual([s.keywords, s.country, s.level, s.remote_only, s.city], ["data analyst", "Ghana", "mid", false, "Accra"]);
  assert.equal((await call(`/unsubscribe/${token}`, { method: "POST" })).status, 200);
  assert.equal((await q("SELECT * FROM subscribers")).length, 0);
  assert.equal((await q("SELECT subscriber_id FROM payments"))[0].subscriber_id, null);
});

test("user text is escaped in pages", async () => {
  await signUp({ keywords: "<script>alert(1)</script>, pr, sales, marketing, editor" });
  const { token } = await subscriber();
  for (const path of [`/pay/${token}`, `/manage/${token}`]) {
    const page = await (await call(path)).text();
    assert.doesNotMatch(page, /<script>alert/);
  }
  assert.match(await (await call(`/manage/${token}`)).text(), /&lt;script&gt;/);
});

test("logo, icons and link-preview image are served, and pages point at them", async () => {
  const home = await (await call("/")).text();
  assert.match(home, new RegExp(`<meta property="og:image" content="${BASE}/og.jpg">`));
  assert.match(home, /<link rel="icon" href="\/favicon.svg"/);
  for (const [path, type, magic] of [["/og.jpg", "image/jpeg", [0xff, 0xd8]], ["/favicon.png", "image/png", [0x89, 0x50]],
                                     ["/apple-touch-icon.png", "image/png", [0x89, 0x50]]]) {
    const res = await call(path);
    assert.equal(res.headers.get("content-type"), type);
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())].slice(0, 2), magic);
  }
  assert.match(await (await call("/favicon.svg")).text(), /^<svg/);
});

test("paying members can connect Telegram; trial users can't, and the webhook checks its secret", async () => {
  env.TELEGRAM_TOKEN = "TGTOKEN";
  await signUp();
  const { token } = await subscriber();
  await call(`/confirm/${token}`);
  const trial = await (await call(`/manage/${token}`)).text();
  assert.doesNotMatch(trial, /Connect Telegram/);
  assert.doesNotMatch(trial, /free trial searches the first 2/);  // trials started after 17 Oct 2026 14:42 UTC search all 5

  await call(`/pay/${token}`, { method: "POST" });
  await call("/paid?transRef=vs_1");
  const member = await (await call(`/manage/${token}`)).text();
  assert.match(member, new RegExp(`href="https://t.me/JobAlertTestBot\\?start=${token}"`));
  assert.doesNotMatch(member, /free trial searches/);

  const update = (text) => JSON.stringify({ message: { chat: { id: 4242, type: "private" }, text } });
  assert.equal((await call("/telegram/webhook", { method: "POST", body: update(`/start ${token}`),
    headers: { "x-telegram-bot-api-secret-token": "wrong" } })).status, 401);
  assert.equal((await subscriber()).telegram_chat_id, null);

  const secret = createHash("sha256").update("jobalert-webhook:TGTOKEN").digest("hex").slice(0, 48);
  const hook = (text) => call("/telegram/webhook", { method: "POST", body: update(text),
    headers: { "x-telegram-bot-api-secret-token": secret } });
  assert.equal((await hook(`/start ${token}`)).status, 200);
  assert.equal((await subscriber()).telegram_chat_id, "4242");
  assert.match(tg.at(-1).text, /^Connected! New matches/);
  assert.match(await (await call(`/manage/${token}`)).text(), /Telegram alerts are on/);

  await hook("/stop");
  assert.equal((await subscriber()).telegram_chat_id, null);
  await hook("/start not-a-real-token-at-all-xx");
  assert.match(tg.at(-1).text, /didn't work/);
});

test("members can turn WhatsApp alerts on and off from their manage page", async () => {
  env.WHATSAPP_PHONE_ID = "123";
  await signUp();
  const { token } = await subscriber();
  await call(`/confirm/${token}`);
  assert.doesNotMatch(await (await call(`/manage/${token}`)).text(), /name="whatsapp"/); // trial: no box
  assert.match(await (await call(`/whatsapp/${token}`, { method: "POST", form: { whatsapp: "08031234567" } })).text(), /for members/);

  await call(`/pay/${token}`, { method: "POST" });
  await call("/paid?transRef=vs_1");
  assert.match(await (await call(`/manage/${token}`)).text(), /Get new matches on WhatsApp/);
  assert.equal((await call(`/whatsapp/${token}`, { method: "POST", form: { whatsapp: "12" } })).status, 400);
  await call(`/whatsapp/${token}`, { method: "POST", form: { whatsapp: "0803 123 4567" } });
  assert.equal((await subscriber()).whatsapp, "2348031234567");
  assert.match(await (await call(`/manage/${token}`)).text(), /WhatsApp alerts are on[\s\S]*value="\+2348031234567"/);
  await call(`/whatsapp/${token}`, { method: "POST", form: { whatsapp: "" } });
  assert.equal((await subscriber()).whatsapp, null);
});

test("confirming starts the first job search once, and says jobs arrive in minutes", async () => {
  await signUp();
  const { token } = await subscriber();
  assert.match(await (await call(`/confirm/${token}`)).text(), /Tomorrow morning/); // not set up: no dispatch, no promise

  env.GH_TOKEN = "GHTOKEN";
  env.GITHUB_REPO = "owner/repo";
  await call("/subscribe", { method: "POST", form: { email: "new@example.com", keywords: "pr, sales, marketing, editor, writer", work_type: "remote" } });
  const fresh = (await q("SELECT token FROM subscribers WHERE email = 'new@example.com'"))[0].token;
  const r = await call(`/confirm/${fresh}`);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), `/found/${fresh}`);
  assert.deepEqual(gh, [{ ref: "main", inputs: { only_email: "new@example.com", first: "1" } }]);
  await call(`/confirm/${fresh}`); // clicking the link again doesn't search again
  assert.equal(gh.length, 1);
});

test("every 2 invited friends who become paying members give the inviter a free month; signing up alone doesn't", async () => {
  await signUp();
  const ada = await subscriber();
  await call(`/confirm/${ada.token}`);
  const page = await (await call(`/manage/${ada.token}`)).text();
  const code = page.match(/\?ref=(\w+)/)[1];
  assert.match(page, /Invite 2 friends, get a month free/);
  const before = new Date((await subscriber()).paid_until);
  const adaUntil = async () => new Date((await q("SELECT paid_until FROM subscribers WHERE id = $1", [ada.id]))[0].paid_until);

  const friend = async (email) => {
    assert.match(await (await call(`/?ref=${code}`)).text(), new RegExp(`name="ref" value="${code}"`));
    await call("/subscribe", { method: "POST", form: { email, keywords: "pr, sales, marketing, editor, writer", work_type: "remote", ref: code } });
    const { token } = (await q("SELECT token FROM subscribers WHERE email = $1", [email]))[0];
    await call(`/confirm/${token}`);
    return token;
  };
  const one = await friend("one@example.com");
  const two = await friend("two@example.com");
  assert.equal((await adaUntil()).getTime(), before.getTime()); // confirming earns nothing
  assert.match(await (await call(`/manage/${ada.token}`)).text(), /0 of 2 friends became members &middot; 2 joined/);

  await call(`/pay/${one}`, { method: "POST" });
  await call("/paid?transRef=vs_1");
  await call("/paid?transRef=vs_1"); // the same payment reported twice counts once
  assert.equal((await adaUntil()).getTime(), before.getTime()); // one paying friend isn't enough yet
  sent.length = 0;
  await call(`/pay/${two}`, { method: "POST" });
  await call("/paid?transRef=vs_2");
  assert.equal(Math.round(((await adaUntil()) - before) / 86400000), 30);
  assert.ok(sent.some((m) => m.to[0].email === "ada@example.com" && /free month/.test(m.subject) && /became members/.test(m.textContent)));
  assert.match(await (await call(`/manage/${ada.token}`)).text(), /0 of 2 friends became members &middot; 2 joined &middot; 1 free month earned/);

  // Re-subscribing an existing address through someone's link doesn't count.
  await call("/subscribe", { method: "POST", form: { email: "Ada@Example.com", keywords: "pr, sales, marketing, editor, writer", work_type: "remote", ref: code } });
  assert.equal((await q("SELECT referred_by FROM subscribers WHERE id = $1", [ada.id]))[0].referred_by, null);
});

test("members get an AI cover letter from their CV; trial users are asked to join", async () => {
  env.ANTHROPIC_API_KEY = "sk-test";
  await signUp();
  const { token } = await subscriber();
  await call(`/confirm/${token}`);
  const link = `/letter/${token}?t=PR%20Associate&c=Acme&u=${encodeURIComponent("https://jobs.example/pr-1")}`;
  assert.match(await (await call(link)).text(), /Cover letters are for members/);

  await call(`/pay/${token}`, { method: "POST" });
  await call("/paid?transRef=vs_1");
  const form = await (await call(link)).text();
  assert.match(form, /PR Associate at Acme/);
  assert.match(form, /name="cv"[^>]*required/);

  const done = await (await call(link, { method: "POST", form: { cv: "Ada Obi. Comms officer at Lagos NGO, 2 years." } })).text();
  assert.match(done, /Dear Hiring Manager/);
  assert.match(done, /9 of 10 left today/);
  assert.equal(ai[0].model, "claude-opus-5-5");
  assert.match(ai[0].messages[0].content, /Comms officer at Lagos NGO/);
  assert.match(ai[0].messages[0].content, /Write press releases\./);
  assert.doesNotMatch(ai[0].messages[0].content, /x\(\)/);

  // The CV is remembered: writing again needs no paste.
  assert.match(await (await call(link, { method: "POST", form: {} })).text(), /8 of 10 left today/);
  assert.equal(ai.length, 2);
});

test("members get their CV tailored to a job, counted apart from letters, and can download it for Word", async () => {
  env.ANTHROPIC_API_KEY = "sk-test";
  await signUp();
  const { token } = await subscriber();
  await call(`/confirm/${token}`);
  const link = `/cv/${token}?t=PR%20Associate&c=Acme&u=${encodeURIComponent("https://jobs.example/pr-1")}`;
  assert.match(await (await call(link)).text(), /Tailored CVs are for members/);

  await call(`/pay/${token}`, { method: "POST" });
  await call("/paid?transRef=vs_1");
  const form = await (await call(link)).text();
  assert.match(form, /Your CV for this job/);
  assert.match(form, /Tailor my CV/);

  const done = await (await call(link, { method: "POST", form: { cv: "Ada Obi. Comms officer at Lagos NGO, 2 years." } })).text();
  assert.match(done, /Download for Word/);
  // The download is a real .docx (a zip) sent by the Worker as a file, so phone in-app browsers can save it too.
  const action = done.match(/<form method="post" action="([^"]+)"[^>]*><textarea name="text" hidden>/)[1].replace(/&amp;/g, "&");
  assert.match(action, /^\/cv\/[\w-]+\/docx\?t=PR\+Associate&c=Acme$/);
  const file = await call(action, { method: "POST", form: { text: "Ada Obi\nSUMMARY\n- Comms & PR" } });
  assert.equal(file.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.match(file.headers.get("content-disposition"), /^attachment; filename="CV - PR Associate - Acme\.docx"/);
  const bytes = new Uint8Array(await file.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.match(new TextDecoder().decode(bytes), /<w:t xml:space="preserve">•\tComms &amp; PR<\/w:t>/);
  // Only members can turn text into a file.
  assert.equal((await call(action.replace(token, "nope"), { method: "POST", form: { text: "x" } })).status, 404);
  assert.doesNotMatch(done, /createObjectURL/);
  assert.match(done, /9 of 10 left today/);
  assert.match(done, /href="\/letter\/[\w-]+\?t=PR\+Associate/); // and a cover letter for the same job
  assert.match(ai[0].system, /Rewrite the applicant's CV/);
  assert.match(ai[0].system, /never invent/);
  assert.match(ai[0].messages[0].content, /Comms officer at Lagos NGO/);
  assert.match(ai[0].messages[0].content, /Write press releases\./);

  // Letters have their own 10 a day, and use the CV saved above.
  const letter = await (await call(`/letter/${token}?t=PR%20Associate&c=Acme`, { method: "POST", form: {} })).text();
  assert.match(letter, /9 of 10 left today/);
  assert.match(ai[1].system, /cover letters/);
  assert.deepEqual((await q("SELECT kind FROM letters ORDER BY id")).map((r) => r.kind), ["cv", "letter"]);
});

test("members get interview prep for a job, built from their CV", async () => {
  env.ANTHROPIC_API_KEY = "sk-test";
  await signUp();
  const { token } = await subscriber();
  await call(`/confirm/${token}`);
  const link = `/prep/${token}?t=PR%20Associate&c=Acme&u=${encodeURIComponent("https://jobs.example/pr-1")}`;
  assert.match(await (await call(link)).text(), /Interview prep sheets are for members/);

  await call(`/pay/${token}`, { method: "POST" });
  await call("/paid?transRef=vs_1");
  assert.match(await (await call(link)).text(), /Prepare me/);
  const done = await (await call(link, { method: "POST", form: { cv: "Ada Obi. Comms officer at Lagos NGO, 2 years." } })).text();
  assert.match(done, /Interview prep/);
  assert.match(done, /9 of 10 left today/);
  assert.match(ai[0].system, /LIKELY QUESTIONS/);
  assert.match(ai[0].messages[0].content, /Comms officer at Lagos NGO/);
  assert.deepEqual((await q("SELECT kind FROM letters ORDER BY id")).map((r) => r.kind), ["prep"]);
});

test("job titles come from the list plus 'Something else', and the manage page ticks them again", async () => {
  await signUp();
  const { token } = await subscriber();
  await call(`/manage/${token}`, { method: "POST", form: [["job", "Data analyst"], ["job", "Not on the list"],
    ["job", "Virtual assistant"], ["other", "public relations, data analyst"], ["work_type", "remote"]] });
  assert.equal((await subscriber()).keywords, "Data analyst, Virtual assistant, public relations");
  const page = await (await call(`/manage/${token}`)).text();
  assert.match(page, /value="Data analyst" checked/);
  assert.doesNotMatch(page, /value="Content writer" checked/);
  assert.match(page, /id="other"[^>]*value="public relations"/);
  const none = await call(`/manage/${token}`, { method: "POST", form: { other: " ", work_type: "remote" } });
  assert.equal(none.status, 400);
});

test("the 06:00 cron trigger starts the morning run for everyone", async () => {
  env.GH_TOKEN = "GHTOKEN";
  env.GITHUB_REPO = "owner/repo";
  const waits = [];
  await worker.scheduled({ cron: "0 6 * * *" }, env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  assert.deepEqual(gh.at(-1), { ref: "main", inputs: { first: "0" } });
});

test("the 06:30 tick starts the owner's daily check-up, once", async () => {
  env.GH_TOKEN = "GHTOKEN";
  env.GITHUB_REPO = "owner/repo";
  const ticks = ["06:00", "06:15", "06:30", "06:45", "07:30", "18:30"].map((t) => new Date(`2026-10-18T${t}:00Z`));
  assert.deepEqual(ticks.filter(isCheckupTick).map((d) => d.toISOString().slice(11, 16)), ["06:30"]);
  assert.equal(await firstSearch.checkup(env), true);
  assert.deepEqual(gh.filter((b) => b.workflow === "job_alerts_health"), [{ workflow: "job_alerts_health", ref: "main", inputs: {} }]);
});

test("the owner's dashboard needs the secret key and shows who got this morning's jobs", async () => {
  env.GH_TOKEN = "GHTOKEN";
  env.GITHUB_REPO = "owner/repo";
  assert.equal((await call("/admin/anything-at-all-long-enough")).status, 404); // no ADMIN_KEY: no dashboard
  env.ADMIN_KEY = "k".repeat(32);
  await signUp();
  await call(`/confirm/${(await subscriber()).token}`);
  await signUp({ email: "bo@example.com" });
  await call(`/confirm/${(await q("SELECT token FROM subscribers WHERE email = 'bo@example.com'"))[0].token}`);
  await signUp({ email: "<b>cy</b>@example.com" }); // never confirmed
  await q(`UPDATE subscribers SET last_run_at = now(), last_run_result = 'sent 5 jobs' WHERE email = 'ada@example.com'`);
  await q(`UPDATE subscribers SET last_run_at = now() - interval '3 days', last_run_result = 'no new matches' WHERE email = 'bo@example.com'`);

  assert.equal((await call("/admin/" + "k".repeat(31) + "x")).status, 404);
  assert.match(await (await call("/admin/")).text(), /type="password"/); // bare /admin/ asks for the password
  const r = await call("/admin/" + "k".repeat(32));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const page = await r.text();
  assert.match(page, /ada@example\.com[\s\S]*trial until/);
  assert.match(page, /✓ This morning: sent 5 jobs/);
  assert.match(page, /⚠ Not reached this morning/);
  assert.match(page, /1 of 2 active users searched this morning/);
  assert.match(page, /Not searched until they confirm/);
  assert.ok(!page.includes("<b>cy</b>"), "emails are escaped");
  assert.match(page, /noindex/);
  assert.match(page, /passed/);
  assert.ok(!page.includes("pr-check"), "code checks on pull requests aren't listed as job runs");

  // The login page: wrong password refused, right one (with stray spaces) opens it and is remembered.
  assert.match(await (await call("/admin")).text(), /type="password"/);
  const bad = await call("/admin", { method: "POST", form: { key: "nope" } });
  assert.equal(bad.status, 401);
  assert.match(await bad.text(), /doesn't match/);
  const good = await call("/admin", { method: "POST", form: { key: ` ${"k".repeat(32)} ` } });
  assert.equal(good.status, 200);
  assert.match(await good.text(), /1 of 2 active users/);
  const cookie = good.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  assert.ok(!cookie.includes("k".repeat(32)), "the cookie isn't the password");
  const again = await call("/admin", { headers: { cookie: cookie.split(";")[0] } });
  assert.match(await again.text(), /1 of 2 active users/);
  assert.match(await (await call("/admin", { headers: { cookie: "ja_admin=" + "0".repeat(64) } })).text(), /type="password"/);
  // Keys with symbols still work in the link.
  env.ADMIN_KEY = "Ab3/x#y?z%Q+long-enough!";
  assert.equal((await call("/admin/" + encodeURIComponent(env.ADMIN_KEY))).status, 200);
  assert.equal((await call("/admin/Ab3/x")).status, 404);
});

test("before 06:30 UTC the dashboard judges yesterday's morning run", () => {
  assert.equal(admin.runWindow(new Date("2026-10-14T06:10:00Z")).toISOString(), "2026-10-13T05:00:00.000Z");
  assert.equal(admin.runWindow(new Date("2026-10-14T09:00:00Z")).toISOString(), "2026-10-14T05:00:00.000Z");
});

test("the dashboard flags users whose first search never ran", async () => {
  env.ADMIN_KEY = "k".repeat(32);
  await signUp();
  await call(`/confirm/${(await subscriber()).token}`);
  let page = await (await call("/admin/" + "k".repeat(32))).text();
  assert.ok(!page.includes("never had a job search"), "just confirmed: give the first search time");
  await q("UPDATE subscribers SET created_at = now() - interval '2 hours'");
  page = await (await call("/admin/" + "k".repeat(32))).text();
  assert.match(page, /1 active user has never had a job search/);
  assert.match(page, /Never searched: their first search didn't start/);
  assert.match(page, /Needs attention/);
});

test("each job has its own page: the advert, how to apply, then one button to the employer", async () => {
  env.ANTHROPIC_API_KEY = "sk-test";
  await signUp();
  const sub0 = await subscriber();
  await call(`/confirm/${sub0.token}`);
  const { token } = sub0;
  const [{ id }] = await q(`INSERT INTO sent_jobs (subscriber_id, job_key, sent_at, title, company, url, source, location, pay, matched, description, posted_at)
    VALUES ($1, 'k1', now(), 'Support Agent', 'Supabase', 'https://jobs.ashbyhq.com/supabase/1', 'Company careers page', 'Remote, Global',
            '$2,000 a month', 'open to Nigeria · matches "customer support" · posted 15 Oct', 'We help developers.\nWhat you will do:\n• Answer tickets\n• Write <docs>', now())
    RETURNING id`, [sub0.id]);
  const [{ id: wwr }] = await q(`INSERT INTO sent_jobs (subscriber_id, job_key, sent_at, title, company, url, source)
    VALUES ($1, 'k2', now(), 'Assistant', 'Beta', 'https://weworkremotely.com/x', 'We Work Remotely') RETURNING id`, [sub0.id]);

  let page = await (await call(`/j/${token}/${id}`)).text();
  assert.match(page, /<h1>Support Agent<\/h1>/);
  assert.match(page, /Remote, Global[\s\S]*\$2,000 a month[\s\S]*open to Nigeria/);
  assert.match(page, /How to apply[\s\S]*No account needed/);
  assert.match(page, /<li>Answer tickets<\/li><li>Write &lt;docs&gt;<\/li>/);
  assert.match(page, new RegExp(`href="/go/${token}/${id}"[^>]*>Apply on Supabase's site`));
  assert.match(page, /data-unlock="cv"/, "trial users see the CV tools, and tapping them offers membership");
  assert.doesNotMatch(page, /Did you apply\?/);

  page = await (await call(`/j/${token}/${wwr}`)).text();
  assert.match(page, /Sign-up needed to apply/);
  assert.match(page, /Go to the advert on We Work Remotely/);
  assert.match(page, /The full advert is on We Work Remotely/);

  await call(`/pay/${token}`, { method: "POST" });
  await call("/paid?transRef=vs_1");
  page = await (await call(`/j/${token}/${id}`)).text();
  assert.match(page, /Did you apply\?[\s\S]*formaction="\/job\/[\w-]+\/\d+\/applied"/);
  assert.doesNotMatch(page, /data-unlock/);
  assert.equal((await call(`/j/not-a-real-token-at-all/${id}`)).status, 404);
});

test("tailored CVs use the advert saved with the emailed job when its page blocks the Worker", async () => {
  env.ANTHROPIC_API_KEY = "sk-test";
  await signUp();
  const { id, token } = await subscriber();
  await call(`/confirm/${token}`);
  await call(`/pay/${token}`, { method: "POST" });
  await call("/paid?transRef=vs_1");
  const url = "https://blocked.example/support-9";
  const advert = "<p>We need a Customer Support Specialist fluent in Zendesk who answers tickets within 2 hours.</p> " + "Details. ".repeat(200);
  await q(`INSERT INTO sent_jobs (subscriber_id, job_key, sent_at, title, company, url, description)
    VALUES ($1, 'k:support-9', now(), 'Customer Support Specialist', 'Dressly', $2, $3)`, [id, url, advert]);
  const link = `/cv/${token}?t=Customer%20Support%20Specialist&c=Dressly&u=${encodeURIComponent(url)}`;
  await call(link, { method: "POST", form: { cv: "Ada Obi. Support agent at Konga, 2 years, Zendesk." } });
  const sent = ai.at(-1);
  assert.match(sent.messages[0].content, /fluent in Zendesk who answers tickets within 2 hours\./);
  assert.doesNotMatch(sent.messages[0].content, /<p>|couldn't be read|Just a moment/);
  assert.match(sent.system, /A CV that would suit any job is a failure/);
  assert.equal(sent.output_config.effort, "medium");
});

test("members track applications: Apply links note the click, one-tap answers save only on POST, and the tracker lists them", async () => {
  env.ANTHROPIC_API_KEY = "sk-test";
  await signUp();
  const sub0 = await subscriber();
  await call(`/confirm/${sub0.token}`);
  const add = async (title, url) => (await q(`INSERT INTO sent_jobs (subscriber_id, job_key, sent_at, title, company, url)
    VALUES ($1, $2, now(), $3, 'Acme', $4) RETURNING id`, [sub0.id, `t:${title}`, title, url]))[0].id;
  const pr = await add("PR Associate", "https://jobs.example/pr-1");
  const va = await add("Virtual Assistant", "https://jobs.example/va-2");
  const { token } = sub0;

  // Trial users don't get the tracker page.
  assert.match(await (await call(`/applications/${token}`)).text(), /Your applications are for members/);
  await call(`/pay/${token}`, { method: "POST" });
  await call("/paid?transRef=vs_1");

  // Apply link: forwards to the advert and notes the click; someone else's token can't use it.
  const go = await call(`/go/${token}/${pr}`);
  assert.equal(go.status, 302);
  assert.equal(go.headers.get("location"), "https://jobs.example/pr-1");
  assert.ok((await q("SELECT clicked_at FROM sent_jobs WHERE id = $1", [pr]))[0].clicked_at);
  assert.equal((await call(`/go/not-a-real-token-at-all/${pr}`)).status, 404);

  // Making a CV for a job counts as a sign too.
  await call(`/cv/${token}?t=Virtual%20Assistant&c=Acme&u=${encodeURIComponent("https://jobs.example/va-2")}`,
    { method: "POST", form: { cv: "Ada Obi. Assistant, 2 years." } });
  assert.ok((await q("SELECT clicked_at FROM sent_jobs WHERE id = $1", [va]))[0].clicked_at);

  // Opening the answer link (as a mail app's link checker would) saves nothing; the page's POST does.
  const page = await (await call(`/job/${token}/${pr}/applied`)).text();
  assert.match(page, /Save: Applied/);
  assert.equal((await q("SELECT status FROM sent_jobs WHERE id = $1", [pr]))[0].status, null);
  const saved = await call(`/job/${token}/${pr}/applied`, { method: "POST" });
  assert.equal(saved.status, 303);
  assert.equal(saved.headers.get("location"), `${BASE}/applications/${token}?saved=${pr}`);
  await call(`/job/${token}/${va}/not_yet`, { method: "POST" });
  assert.equal((await call(`/job/${token}/${va}/hired`, { method: "POST" })).status, 404);

  let tracker = await (await call(`/applications/${token}?saved=${pr}`)).text();
  assert.match(tracker, /Still deciding[\s\S]*Virtual Assistant[\s\S]*Applied<\/h2>[\s\S]*PR Associate/);
  assert.match(tracker, /<b>1<\/b><span>Applied/);

  // Moving it on to an interview, then "Not for me" hides the other one.
  await call(`/job/${token}/${pr}/interview`, { method: "POST" });
  await call(`/job/${token}/${va}/skip`, { method: "POST" });
  tracker = await (await call(`/applications/${token}`)).text();
  assert.match(tracker, /<b>1<\/b><span>Interviews/);
  assert.doesNotMatch(tracker, /Virtual Assistant/);
  const managed = await (await call(`/manage/${token}`)).text();
  assert.match(managed, /My applications/);
  assert.match(managed, new RegExp(`href="/login/${token}">🏠 My dashboard`));
});

test("members log in with an emailed link: once, scanner-safe, 30-day cookie, and log out ends it", async () => {
  await signUp();
  const sub0 = await subscriber();
  await call(`/confirm/${sub0.token}`);
  await q(`INSERT INTO sent_jobs (subscriber_id, job_key, sent_at, title, company, url) VALUES ($1, 'k', now(), 'PR Associate', 'Acme', 'https://jobs.example/1')`, [sub0.id]);
  assert.match(await (await call("/")).text(), /href="\/login">Log in</);
  assert.equal((await call("/me")).headers.get("location"), "/login");

  // Unknown emails get the same answer and no email.
  sent = [];
  assert.match(await (await call("/login", { method: "POST", form: { email: "nobody@example.com" } })).text(), /Check your inbox/);
  assert.equal(sent.length, 0);
  assert.match(await (await call("/login", { method: "POST", form: { email: "ADA@example.com" } })).text(), /Check your inbox/);
  assert.equal(sent.length, 1);
  const link = sent[0].textContent.match(/\/signin\/[\w-]+/)[0];
  await call("/login", { method: "POST", form: { email: "ada@example.com" } }); // a second ask within 2 minutes sends nothing
  assert.equal(sent.length, 1);

  // Opening the link (as a mail app's checker would) doesn't use it; the page's POST does, once.
  assert.match(await (await call(link)).text(), /Logging you in/);
  const ok = await call(link, { method: "POST" });
  assert.equal(ok.status, 303);
  const cookie = ok.headers.get("set-cookie");
  assert.match(cookie, /ja_session=[\w-]+; Path=\/; Max-Age=34560000; HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await call(link, { method: "POST" })).status, 410);
  assert.ok(!(await q("SELECT session_hash FROM logins"))[0].session_hash.includes(cookie.split(/[=;]/)[1]));

  const headers = { cookie: cookie.split(";")[0] };
  const home = await (await call("/me", { headers })).text();
  assert.match(home, /ada@example.com/);
  assert.match(home, /Today's jobs · 1/);
  assert.match(home, /PR Associate[\s\S]*href="\/j\/[\w-]+\/\d+"/);
  // Trial users see the same tiles; tapping a member feature opens the "join" card.
  assert.match(home, /data-unlock="apps"[\s\S]*data-unlock="telegram"[\s\S]*data-unlock="cv"[\s\S]*data-unlock="letter"/);
  assert.match(home, /<dialog id="unlock"[\s\S]*href="\/pay\/[\w-]+">Join for/);
  const again = await call("/login", { headers }); // logged in already: straight to their page, and the cookie is renewed
  assert.equal(again.headers.get("location"), "/me");
  assert.match(again.headers.get("set-cookie"), /Max-Age=34560000/);
  assert.ok((await q("SELECT expires_at FROM logins WHERE session_hash IS NOT NULL"))[0].expires_at > new Date(Date.now() + 29 * 365 * 864e5));

  await call("/me/cv", { method: "POST", form: { cv: "Ada Obi, comms officer." }, headers });
  assert.equal(await (await import("../src/db.js")).getCv(q, sub0.id), "Ada Obi, comms officer.");
  assert.match(await (await call("/me?saved=cv", { headers })).text(), /Your CV is saved/);

  // Trial users see "More jobs" as a member feature; it doesn't give them jobs.
  assert.match(home, /class="more" href="[^"]+" data-unlock="more"/);
  assert.equal((await call("/me/more", { method: "POST", headers })).headers.get("location"), "/me");

  // Members: the dashboard keeps 5 jobs; "More jobs" swaps in the next 5 of the morning's spares, best first.
  await q("UPDATE subscribers SET paid_until = now() + interval '30 days' WHERE id = $1", [sub0.id]);
  await q("INSERT INTO payments (reference, subscriber_id, amount_ngn, paid_at) VALUES ('m1', $1, 3500, now())", [sub0.id]);
  for (let i = 1; i <= 6; i++) {
    await q(`INSERT INTO sent_jobs (subscriber_id, job_key, sent_at, title, on_board) VALUES ($1, $2, now(), $3, $4)`, [sub0.id, `a${i}`, `Morning ${i}`, i > 1]);
  }
  for (let i = 0; i < 7; i++) {
    await q(`INSERT INTO spare_jobs (subscriber_id, rank, job_key, title, company, url) VALUES ($1, $2, $3, $4, 'Co', 'https://jobs.example/s')`,
      [sub0.id, i, i === 0 ? "a2" : `s${i}`, `Spare ${i}`]); // the first was sent since (by Telegram, say): skipped
  }
  let mine = await (await call("/me", { headers })).text();
  assert.equal((mine.match(/class="card mjob"/g) || []).length, 5);
  assert.match(mine, /Morning 2[\s\S]*Morning 6/);
  assert.doesNotMatch(mine, /Morning 1</);
  assert.match(mine, /action="\/me\/more"/);
  assert.equal((await call("/me/more", { method: "POST", headers })).headers.get("location"), "/me?saved=more#jobs");
  mine = await (await call("/me?saved=more", { headers })).text();
  assert.match(mine, /Here are 5 more jobs/);
  assert.match(mine, /Spare 1[\s\S]*Spare 5/);
  assert.doesNotMatch(mine, /Morning|Spare 0|Spare 6/);
  assert.match(mine, /action="\/me\/more"/); // one spare left
  await call("/me/more", { method: "POST", headers });
  mine = await (await call("/me", { headers })).text();
  assert.match(mine, /Spare 6/);
  assert.equal((mine.match(/class="card mjob"/g) || []).length, 1);
  assert.doesNotMatch(mine, /action="\/me\/more"/);
  assert.equal((await call("/me/more", { method: "POST", headers })).headers.get("location"), "/me?saved=nomore#jobs");
  assert.equal((await q("SELECT count(*)::int AS n FROM sent_jobs WHERE subscriber_id = $1", [sub0.id]))[0].n, 13);

  await call("/logout", { method: "POST", headers });
  assert.equal((await call("/me", { headers })).headers.get("location"), "/login");

  // The "Log in" button in a job email logs them straight in (GET only shows the auto-submit page).
  assert.match(await (await call(`/login/${sub0.token}`)).text(), /Logging you in/);
  const direct = await call(`/login/${sub0.token}`, { method: "POST" });
  assert.equal(direct.headers.get("location"), "/me");
  const fresh = { cookie: direct.headers.get("set-cookie").split(";")[0] };
  assert.match(await (await call("/me", { headers: fresh })).text(), /ada@example.com/);
  assert.equal((await call(`/login/${sub0.token}`, { headers: fresh })).headers.get("location"), "/me"); // already in
  assert.equal((await call("/login/not-a-real-token", { method: "POST" })).headers.get("location"), "/login");
});

test("the search form saves Hours (any, full-time or part-time), and junk values fall back to any", async () => {
  const home = await (await call("/")).text();
  assert.match(home, /name="hours" type="radio" value="any" checked[\s\S]*value="full"[\s\S]*value="part"/);
  await signUp({ hours: "part" });
  let sub = await subscriber();
  assert.equal(sub.hours, "part");
  const manage = await (await call(`/manage/${sub.token}`)).text();
  assert.match(manage, /id="h_part" name="hours" type="radio" value="part" checked/);
  await call(`/manage/${sub.token}`, { method: "POST", form: { job: "Virtual assistant", country: "Nigeria", work_type: "remote", level: "any", hours: "weekends" } });
  sub = await subscriber();
  assert.equal(sub.hours, "any");
});

test("the sign-up cards' 'Another country' list is saved like the main list", async () => {
  await signUp({ country: "other", country_other: "Egypt" });
  assert.equal((await subscriber()).country, "Egypt");
  await call("/subscribe", { method: "POST", form: { email: "b@example.com", job: "Customer support", other: "pr, sales, marketing, editor", country: "other", country_other: "Atlantis" } });
  assert.equal((await q("SELECT country FROM subscribers WHERE email = 'b@example.com'"))[0].country, "");
});

test("after confirming, new sign-ups wait for their first jobs, then see 3 with the rest blurred and the offer", async () => {
  await signUp();
  const s = await subscriber();
  assert.equal((await call(`/found/${s.token}`)).status, 404); // not confirmed yet
  await call(`/confirm/${s.token}`);
  const waiting = await (await call(`/found/${s.token}`)).text();
  assert.match(waiting, /Finding your jobs/);
  assert.match(waiting, new RegExp(`http-equiv="refresh" content="5;url=/found/${s.token}\\?n=1"`));
  assert.doesNotMatch(await (await call(`/found/${s.token}?n=36`)).text(), /http-equiv="refresh"/); // stops reloading after ~3 minutes

  for (const [i, title] of ["Virtual Assistant", "Data Entry Clerk", "Admin Assistant"].entries()) {
    await q(`INSERT INTO sent_jobs (subscriber_id, job_key, sent_at, title, company, location, matched, on_board)
      VALUES ($1, $2, now(), $3, 'Acme', 'Worldwide', 'open to Nigeria · remote, Worldwide', true)`, [s.id, `k${i}`, title]);
  }
  for (let i = 0; i < 12; i++) {
    await q(`INSERT INTO spare_jobs (subscriber_id, rank, job_key, title, company, url) VALUES ($1, $2, $3, 'Secret Job', 'Hidden Co', 'https://x')`, [s.id, i, `spare${i}`]);
  }
  await q("UPDATE subscribers SET last_run_at = now() WHERE id = $1", [s.id]);
  const ready = await (await call(`/found/${s.token}`)).text();
  assert.match(ready, /We found 15 jobs for you/);
  assert.match(ready, /Virtual Assistant[\s\S]*Data Entry Clerk[\s\S]*Admin Assistant/);
  assert.match(ready, /✓ open to Nigeria/);
  assert.match(ready, /\+12 more jobs/);
  assert.doesNotMatch(ready, /Secret Job|Hidden Co/); // the blurred jobs aren't the real ones
  assert.match(ready, new RegExp(`href="/pay/${s.token}">Unlock all, ₦5,000<small>Get a tailored CV and cover letter for each job`));
  assert.match(ready, new RegExp(`href="/login/${s.token}">start the free trial`));
  assert.match(ready, /Is this real\?[\s\S]*Every job is checked[\s\S]*Nothing renews automatically/);

  await q("DELETE FROM sent_jobs");
  assert.match(await (await call(`/found/${s.token}`)).text(), /Change my job titles/); // searched, nothing found
});

test("sign-up needs 5 job titles, and a job-link sign-up gets the job's similar titles", async () => {
  const r = await signUp({ keywords: "virtual assistant, pr" });
  assert.equal(r.status, 400);
  assert.match(await r.text(), /Pick 5 jobs/);
  assert.equal(await subscriber(), undefined);
});

test("a first search that never started is started again by the hourly check", async () => {
  await signUp();
  const { token } = await subscriber();
  await call(`/confirm/${token}`); // no GH_TOKEN yet: the first search can't start
  await q("UPDATE subscribers SET created_at = now() - interval '1 hour'");
  env.GH_TOKEN = "GHTOKEN";
  env.GITHUB_REPO = "owner/repo";
  assert.deepEqual(await retryFirstSearches(env, q), ["ada@example.com"]);
  assert.deepEqual(gh.at(-1), { ref: "main", inputs: { only_email: "ada@example.com", first: "1" } });
  await q("UPDATE subscribers SET last_run_at = now()");
  assert.deepEqual(await retryFirstSearches(env, q), []); // searched: nothing to do
});
