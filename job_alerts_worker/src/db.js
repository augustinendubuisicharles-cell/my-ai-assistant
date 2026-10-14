// Queries against the same Postgres (Neon) tables the Python side creates and
// uses (job_alerts/db.py owns the schema). `q(text, params)` returns rows.
const COLS = "id, email, keywords, country, remote_only, city, level, token, confirmed, paid_until, telegram_chat_id, ref_code, referred_by, ref_rewards";

const one = async (q, text, params) => (await q(text, params))[0] || null;

export function randomToken() {
  // Same shape as Python's secrets.token_urlsafe(32): 43 URL-safe characters.
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const byEmail = (q, email) =>
  one(q, `SELECT ${COLS} FROM subscribers WHERE email = $1`, [email.trim().toLowerCase()]);

export const byToken = (q, token) => one(q, `SELECT ${COLS} FROM subscribers WHERE token = $1`, [token]);

export const byId = (q, id) => one(q, `SELECT ${COLS} FROM subscribers WHERE id = $1`, [id]);

// Creates an unconfirmed subscriber, or updates an existing one's preferences.
export const upsertSubscriber = (q, email, p) =>
  one(q, `INSERT INTO subscribers (email, keywords, country, remote_only, city, level, token, confirmed, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, false, now())
          ON CONFLICT (email) DO UPDATE SET keywords = EXCLUDED.keywords, country = EXCLUDED.country,
            remote_only = EXCLUDED.remote_only, city = EXCLUDED.city, level = EXCLUDED.level
          RETURNING ${COLS}`,
  [email.trim().toLowerCase(), p.keywords, p.country, p.remote_only, p.city, p.level, randomToken()]);

export const confirm = (q, token) =>
  one(q, `UPDATE subscribers SET confirmed = true WHERE token = $1 RETURNING ${COLS}`, [token]);

export const updatePrefs = (q, token, p) =>
  q(`UPDATE subscribers SET keywords = $2, country = $3, remote_only = $4, city = $5, level = $6 WHERE token = $1`,
    [token, p.keywords, p.country, p.remote_only, p.city, p.level]);

// Deletes the subscriber and their sent-job history; payment records stay (for accounting).
export async function remove(q, token) {
  const sub = await byToken(q, token);
  if (!sub) return false;
  await q("DELETE FROM sent_jobs WHERE subscriber_id = $1", [sub.id]);
  await q("DELETE FROM letters WHERE subscriber_id = $1", [sub.id]);
  await q("UPDATE payments SET subscriber_id = NULL WHERE subscriber_id = $1", [sub.id]);
  await q("DELETE FROM subscribers WHERE id = $1", [sub.id]);
  return true;
}

// Gives `days` of free alerts to someone who has never had any (trial or paid).
export const startTrial = (q, id, days) =>
  one(q, `UPDATE subscribers SET paid_until = now() + make_interval(days => $2)
          WHERE id = $1 AND paid_until IS NULL RETURNING ${COLS}`, [id, days]).then((s) => s || byId(q, id));

export const isPaid = (sub) => Boolean(sub?.paid_until) && new Date(sub.paid_until) > new Date();

// A paying member with time left (the free trial alone doesn't count): bigger limits and Telegram.
export async function isMember(q, sub) {
  if (!isPaid(sub)) return false;
  return Boolean(await one(q, "SELECT 1 AS y FROM payments WHERE subscriber_id = $1 LIMIT 1", [sub.id]));
}

export const setTelegram = (q, token, chatId) =>
  one(q, `UPDATE subscribers SET telegram_chat_id = $2 WHERE token = $1 RETURNING ${COLS}`, [token, chatId]);

export const clearTelegram = (q, chatId) => q("UPDATE subscribers SET telegram_chat_id = NULL WHERE telegram_chat_id = $1", [chatId]);

// Adds `days` of paid time, once per payment reference: the browser return and the
// webhook can both report the same payment. One statement, so it's atomic.
export async function recordPayment(q, reference, subscriberId, amountNgn, days) {
  const rows = await q(`WITH ins AS (
             INSERT INTO payments (reference, subscriber_id, amount_ngn, paid_at)
             SELECT $1, id, $3, now() FROM subscribers WHERE id = $2
             ON CONFLICT (reference) DO NOTHING RETURNING subscriber_id)
           UPDATE subscribers s
           SET paid_until = GREATEST(now(), COALESCE(s.paid_until, now())) + make_interval(days => $4), confirmed = true
           FROM ins WHERE s.id = ins.subscriber_id RETURNING s.id`, [reference, subscriberId, amountNgn, days]);
  const sub = await byId(q, subscriberId);
  // justPaid: this call recorded the payment (the other report of it finds it already there).
  return sub && { ...sub, justPaid: rows.length > 0 };
}

// --- AI cover letters and tailored CVs (members); kind is "letter" or "cv" ---

export const getCv = async (q, id) => (await one(q, "SELECT cv_text FROM subscribers WHERE id = $1", [id]))?.cv_text || "";
export const setCv = (q, id, cv) => q("UPDATE subscribers SET cv_text = $2 WHERE id = $1", [id, cv]);
export const lettersToday = async (q, id, kind = "letter") =>
  (await one(q, "SELECT count(*)::int AS n FROM letters WHERE subscriber_id = $1 AND kind = $2 AND created_at > now() - interval '1 day'", [id, kind]))?.n || 0;
export const addLetter = (q, id, kind = "letter") => q("INSERT INTO letters (subscriber_id, created_at, kind) VALUES ($1, now(), $2)", [id, kind]);

// --- referrals: every 2 friends who confirm = 1 free month ---

export const REF_PER_REWARD = 2;
export const REF_REWARD_DAYS = 30;

// Their invite code, made on first use. Separate from the token, which opens their settings.
export async function refCode(q, sub) {
  if (sub.ref_code) return sub.ref_code;
  const code = randomToken().replace(/[-_]/g, "").slice(0, 8);
  await q("UPDATE subscribers SET ref_code = $2 WHERE id = $1 AND ref_code IS NULL", [sub.id, code]);
  return (await byId(q, sub.id)).ref_code;
}

export const byRefCode = (q, code) => one(q, `SELECT ${COLS} FROM subscribers WHERE ref_code = $1`, [code]);

// Only for someone signing up for the first time, and never their own link.
export const setReferredBy = (q, id, referrerId) =>
  q("UPDATE subscribers SET referred_by = $2 WHERE id = $1 AND referred_by IS NULL AND id <> $2", [id, referrerId]);

export const confirmedReferrals = async (q, id) =>
  (await one(q, "SELECT count(*)::int AS n FROM subscribers WHERE referred_by = $1 AND confirmed", [id]))?.n || 0;

// Gives the referrer any free months they've newly earned. Returns how many (0 if none).
// The WHERE on ref_rewards makes it safe if two friends confirm at the same moment.
export async function rewardReferrer(q, referrerId) {
  const ref = await byId(q, referrerId);
  if (!ref) return 0;
  const earned = Math.floor((await confirmedReferrals(q, referrerId)) / REF_PER_REWARD);
  const add = earned - (ref.ref_rewards || 0);
  if (add <= 0) return 0;
  const done = await one(q, `UPDATE subscribers SET ref_rewards = $2,
      paid_until = GREATEST(now(), COALESCE(paid_until, now())) + make_interval(days => $3)
      WHERE id = $1 AND ref_rewards = $4 RETURNING id`, [referrerId, earned, add * REF_REWARD_DAYS, ref.ref_rewards || 0]);
  return done ? add : 0;
}
