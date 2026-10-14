// End-to-end tests of the Worker against an in-memory Postgres (PGlite) with the
// exact schema job_alerts/db.py creates, and with Brevo/Credo/Paystack faked.
// Run from job_alerts_worker/:  npm test   (needs python3 and the repo's Python deps)
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { handle } from "../src/index.js";
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
  env = { BREVO_API_KEY: "brevo", FROM_EMAIL: "hi@jobs.test", CREDO_PUBLIC_KEY: "0PUBkey", CREDO_SECRET_KEY: "secret" };
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
  if (u === "https://api.github.com/repos/owner/repo/actions/workflows/job_alerts_daily.yml/dispatches") {
    assert.equal(init.headers.authorization, "Bearer GHTOKEN");
    gh.push(body);
    return new Response(null, { status: 204 });
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
  throw new Error(`unexpected fetch ${u}`);
}

const call = (path, { method = "GET", form, body, headers } = {}) =>
  handle(new Request(BASE + path, {
    method, headers, redirect: "manual",
    body: form ? new URLSearchParams(form) : body,
  }), env, q);

const signUp = (extra = {}) => call("/subscribe", { method: "POST",
  form: { email: "Ada@Example.com", keywords: "virtual assistant, pr", country: "Nigeria", level: "entry", ...extra } });
const subscriber = async () => (await q("SELECT * FROM subscribers"))[0];

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
  assert.match(page, /Up to <b>5 jobs<\/b>[\s\S]*<b>₦5,000<\/b> for 3 months[\s\S]*Up to <b>10 jobs<\/b>/);
  assert.match(page, /₦5,000/);
  assert.match(page, /7 days free/);
  assert.match(page, /How do you want to work\?/);
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
  await signUp({ keywords: "hacker" });
  assert.equal((await subscriber()).keywords, "virtual assistant, pr");
  assert.match(sent.at(-1).subject, /Change your job alerts/);
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

  const done = await call("/paid?transRef=vs_1");
  assert.equal(done.status, 200);
  const s = await subscriber();
  const days = (new Date(s.paid_until) - Date.now()) / 86400000;
  assert.ok(days > 96.9 && days < 97.1, `paid days ${days}`);

  // The webhook reports the same payment: valid signature, but no double count.
  const body = JSON.stringify({ event: "transaction.successful", data: { transRef: "vs_1", businessCode: "700607001" } });
  const sig = createHash("sha512").update("secret700607001").digest("hex");
  assert.equal((await call("/payments/webhook", { method: "POST", body, headers: { "x-credo-signature": sig } })).status, 200);
  assert.equal(String((await subscriber()).paid_until), String(s.paid_until));
  assert.equal((await q("SELECT count(*)::int AS n FROM payments"))[0].n, 1);

  const manage = await (await call(`/manage/${token}`)).text();
  assert.match(manage, /Active until/);
  assert.match(manage, /Pay ₦5,000 for 3 months/);
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
  await signUp({ keywords: "<script>alert(1)</script>" });
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
  assert.match(trial, /free trial searches the first 2/);

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

test("confirming starts the first job search once, and says jobs arrive in minutes", async () => {
  await signUp();
  const { token } = await subscriber();
  assert.match(await (await call(`/confirm/${token}`)).text(), /Tomorrow morning/); // not set up: no dispatch, no promise

  env.GH_TOKEN = "GHTOKEN";
  env.GITHUB_REPO = "owner/repo";
  await call("/subscribe", { method: "POST", form: { email: "new@example.com", keywords: "pr", work_type: "remote" } });
  const fresh = (await q("SELECT token FROM subscribers WHERE email = 'new@example.com'"))[0].token;
  assert.match(await (await call(`/confirm/${fresh}`)).text(), /In a few minutes/);
  assert.deepEqual(gh, [{ ref: "main", inputs: { only_email: "new@example.com", first: "1" } }]);
  await call(`/confirm/${fresh}`); // clicking the link again doesn't search again
  assert.equal(gh.length, 1);
});

test("every 2 invited friends who confirm give the inviter a free month", async () => {
  await signUp();
  const ada = await subscriber();
  await call(`/confirm/${ada.token}`);
  const page = await (await call(`/manage/${ada.token}`)).text();
  const code = page.match(/\?ref=(\w+)/)[1];
  assert.match(page, /Invite 2 friends, get a month free/);
  const before = new Date((await subscriber()).paid_until);

  const friend = async (email) => {
    assert.match(await (await call(`/?ref=${code}`)).text(), new RegExp(`name="ref" value="${code}"`));
    await call("/subscribe", { method: "POST", form: { email, keywords: "pr", work_type: "remote", ref: code } });
    const { token } = (await q("SELECT token FROM subscribers WHERE email = $1", [email]))[0];
    await call(`/confirm/${token}`);
    await call(`/confirm/${token}`); // a second click counts once
  };
  await friend("one@example.com");
  assert.equal(new Date((await subscriber()).paid_until).getTime(), before.getTime());
  sent.length = 0;
  await friend("two@example.com");
  const after = new Date((await q("SELECT paid_until FROM subscribers WHERE id = $1", [ada.id]))[0].paid_until);
  assert.equal(Math.round((after - before) / 86400000), 30);
  assert.ok(sent.some((m) => m.to[0].email === "ada@example.com" && /free month/.test(m.subject)));

  // Re-subscribing an existing address through someone's link doesn't count.
  await call("/subscribe", { method: "POST", form: { email: "Ada@Example.com", keywords: "pr", work_type: "remote", ref: code } });
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
