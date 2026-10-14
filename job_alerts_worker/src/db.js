// Queries against the same Postgres (Neon) tables the Python side creates and
// uses (job_alerts/db.py owns the schema). `q(text, params)` returns rows.
const COLS = "id, email, keywords, country, remote_only, city, level, token, confirmed, paid_until";

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
  await q("UPDATE payments SET subscriber_id = NULL WHERE subscriber_id = $1", [sub.id]);
  await q("DELETE FROM subscribers WHERE id = $1", [sub.id]);
  return true;
}

// Gives `days` of free alerts to someone who has never had any (trial or paid).
export const startTrial = (q, id, days) =>
  one(q, `UPDATE subscribers SET paid_until = now() + make_interval(days => $2)
          WHERE id = $1 AND paid_until IS NULL RETURNING ${COLS}`, [id, days]).then((s) => s || byId(q, id));

export const isPaid = (sub) => Boolean(sub?.paid_until) && new Date(sub.paid_until) > new Date();

// Adds `days` of paid time, once per payment reference: the browser return and the
// webhook can both report the same payment. One statement, so it's atomic.
export async function recordPayment(q, reference, subscriberId, amountNgn, days) {
  await q(`WITH ins AS (
             INSERT INTO payments (reference, subscriber_id, amount_ngn, paid_at)
             SELECT $1, id, $3, now() FROM subscribers WHERE id = $2
             ON CONFLICT (reference) DO NOTHING RETURNING subscriber_id)
           UPDATE subscribers s
           SET paid_until = GREATEST(now(), COALESCE(s.paid_until, now())) + make_interval(days => $4), confirmed = true
           FROM ins WHERE s.id = ins.subscriber_id`, [reference, subscriberId, amountNgn, days]);
  return byId(q, subscriberId);
}

// Real numbers for the home page: people with paid (or, when free, confirmed)
// alerts, and jobs emailed in the last 30 days.
export async function stats(q, paidService) {
  const users = await one(q, paidService
    ? "SELECT count(*)::int AS n FROM subscribers WHERE paid_until > now()"
    : "SELECT count(*)::int AS n FROM subscribers WHERE confirmed", []);
  const jobs = await one(q, "SELECT count(*)::int AS n FROM sent_jobs WHERE sent_at >= now() - interval '30 days'", []);
  return { users: users?.n || 0, jobs_30d: jobs?.n || 0 };
}
