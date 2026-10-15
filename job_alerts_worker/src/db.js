// Queries against the same Postgres (Neon) tables the Python side creates and
// uses (job_alerts/db.py owns the schema). `q(text, params)` returns rows.
const COLS = "id, email, keywords, country, remote_only, city, level, hours, token, confirmed, paid_until, telegram_chat_id, whatsapp, ref_code, referred_by, ref_rewards";

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
  one(q, `INSERT INTO subscribers (email, keywords, country, remote_only, city, level, token, confirmed, created_at, hours)
          VALUES ($1, $2, $3, $4, $5, $6, $7, false, now(), $8)
          ON CONFLICT (email) DO UPDATE SET keywords = EXCLUDED.keywords, country = EXCLUDED.country,
            remote_only = EXCLUDED.remote_only, city = EXCLUDED.city, level = EXCLUDED.level, hours = EXCLUDED.hours
          RETURNING ${COLS}`,
  [email.trim().toLowerCase(), p.keywords, p.country, p.remote_only, p.city, p.level, randomToken(), p.hours || "any"]);

export const confirm = (q, token) =>
  one(q, `UPDATE subscribers SET confirmed = true WHERE token = $1 RETURNING ${COLS}`, [token]);

export const updatePrefs = (q, token, p) =>
  q(`UPDATE subscribers SET keywords = $2, country = $3, remote_only = $4, city = $5, level = $6, hours = $7 WHERE token = $1`,
    [token, p.keywords, p.country, p.remote_only, p.city, p.level, p.hours || "any"]);

// Deletes the subscriber and their sent-job history; payment records stay (for accounting).
export async function remove(q, token) {
  const sub = await byToken(q, token);
  if (!sub) return false;
  await q("DELETE FROM sent_jobs WHERE subscriber_id = $1", [sub.id]);
  await q("DELETE FROM letters WHERE subscriber_id = $1", [sub.id]);
  await q("DELETE FROM logins WHERE subscriber_id = $1", [sub.id]);
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

export const setWhatsapp = (q, token, number) => q("UPDATE subscribers SET whatsapp = $2 WHERE token = $1", [token, number]);
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

// --- referrals: every 2 invited friends who become paying members = 1 free month ---

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

// Invited friends who have paid (free ₦0 grants don't count).
export const paidReferrals = async (q, id) =>
  (await one(q, `SELECT count(*)::int AS n FROM subscribers s WHERE s.referred_by = $1
     AND EXISTS (SELECT 1 FROM payments p WHERE p.subscriber_id = s.id AND p.amount_ngn > 0)`, [id]))?.n || 0;

// Gives the referrer any free months they've newly earned. Returns how many (0 if none).
// The WHERE on ref_rewards makes it safe if two friends confirm at the same moment.
export async function rewardReferrer(q, referrerId) {
  const ref = await byId(q, referrerId);
  if (!ref) return 0;
  const earned = Math.floor((await paidReferrals(q, referrerId)) / REF_PER_REWARD);
  const add = earned - (ref.ref_rewards || 0);
  if (add <= 0) return 0;
  const done = await one(q, `UPDATE subscribers SET ref_rewards = $2,
      paid_until = GREATEST(now(), COALESCE(paid_until, now())) + make_interval(days => $3)
      WHERE id = $1 AND ref_rewards = $4 RETURNING id`, [referrerId, earned, add * REF_REWARD_DAYS, ref.ref_rewards || 0]);
  return done ? add : 0;
}

// --- members' application tracker (sent_jobs rows; job_alerts/db.py has the columns and STATUSES) ---

export const ANSWERS = ["applied", "not_yet", "skip", "interview", "offer", "no_reply"];

export const sentJob = (q, subscriberId, id) =>
  one(q, "SELECT id, title, company, url, source, status, posted_at, location, pay, matched, description FROM sent_jobs WHERE id = $1 AND subscriber_id = $2", [id, subscriberId]);

// They opened the job (the first time counts), or made a CV or letter for it: the next email asks "Did you apply?".
export const markClicked = (q, subscriberId, id) =>
  q("UPDATE sent_jobs SET clicked_at = COALESCE(clicked_at, now()) WHERE id = $1 AND subscriber_id = $2", [id, subscriberId]);
export const markClickedByUrl = (q, subscriberId, url) =>
  q("UPDATE sent_jobs SET clicked_at = COALESCE(clicked_at, now()) WHERE subscriber_id = $1 AND url = $2", [subscriberId, url]);

export const setJobStatus = (q, subscriberId, id, status) =>
  q("UPDATE sent_jobs SET status = $3, status_at = now() WHERE id = $1 AND subscriber_id = $2", [id, subscriberId, status]);

// Everything on their tracker page: answered jobs except "Not for me", newest answer first.
export const applications = (q, subscriberId) =>
  q(`SELECT id, title, company, url, status, status_at, posted_at, sent_at FROM sent_jobs
     WHERE subscriber_id = $1 AND status IS NOT NULL AND status <> 'skip' ORDER BY status_at DESC LIMIT 200`, [subscriberId]);

// --- members' email sign-in (logins table): a one-time link that becomes a 30-day session ---

export const LOGIN_LINK_MINUTES = 30;
export const SESSION_DAYS = 30;

export async function sha256(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A new sign-in link code, unless one was sent in the last 2 minutes (null then: stops inbox flooding).
export async function newLoginCode(q, subscriberId) {
  if (await one(q, "SELECT 1 AS y FROM logins WHERE subscriber_id = $1 AND created_at > now() - interval '2 minutes'", [subscriberId])) return null;
  const code = randomToken();
  await q("INSERT INTO logins (subscriber_id, code_hash, created_at) VALUES ($1, $2, now())", [subscriberId, await sha256(code)]);
  return code;
}

export const loginCodeValid = async (q, code) =>
  one(q, `SELECT id FROM logins WHERE code_hash = $1 AND used_at IS NULL
          AND created_at > now() - make_interval(mins => $2)`, [await sha256(code), LOGIN_LINK_MINUTES]);

// Uses the link (once) and returns the session value for the cookie, or null if the link is used or expired.
export async function startSession(q, code) {
  const session = randomToken();
  const row = await one(q, `UPDATE logins SET used_at = now(), session_hash = $3, expires_at = now() + make_interval(days => $4)
      WHERE code_hash = $1 AND used_at IS NULL AND created_at > now() - make_interval(mins => $2) RETURNING id`,
    [await sha256(code), LOGIN_LINK_MINUTES, await sha256(session), SESSION_DAYS]);
  return row ? session : null;
}

export const bySession = async (q, session) =>
  one(q, `SELECT ${COLS.split(", ").map((c) => `s.${c}`).join(", ")} FROM logins l JOIN subscribers s ON s.id = l.subscriber_id
          WHERE l.session_hash = $1 AND l.expires_at > now()`, [await sha256(session)]);

export const endSession = async (q, session) => q("DELETE FROM logins WHERE session_hash = $1", [await sha256(session)]);

// The jobs sent to them in the last 24 hours (this morning's email and any Telegram alerts since),
// or their last email's jobs if nothing came today. Newest first.
export const latestJobs = (q, subscriberId) =>
  q(`SELECT id, title, company, url, source, status, sent_at FROM sent_jobs
     WHERE subscriber_id = $1 AND title IS NOT NULL
       AND sent_at > LEAST(now() - interval '24 hours', (SELECT max(sent_at) FROM sent_jobs WHERE subscriber_id = $1) - interval '1 hour')
     ORDER BY sent_at DESC, id LIMIT 30`, [subscriberId]);
