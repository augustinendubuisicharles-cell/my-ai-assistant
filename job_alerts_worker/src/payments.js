// Payments, ported from job_alerts/payments.py: one payment of PRICE_NGN buys
// PERIOD_DAYS of alerts. Credo is used when its keys are set, otherwise Paystack.
// Every payment is re-checked with the provider's API before it counts.
const REF_RE = /^ja(\d+)x[0-9a-f]+$/; // our reference: ja<subscriber id>x<random>
const v = (env, k) => (env[k] || "").trim();

export const priceNgn = (env) => parseInt(env.PRICE_NGN || "5000", 10);
export const periodDays = (env) => parseInt(env.PERIOD_DAYS || "90", 10);
export const trialDays = (env) => parseInt(env.TRIAL_DAYS || "7", 10); // free days on confirming

export function provider(env) {
  if (v(env, "CREDO_PUBLIC_KEY") && v(env, "CREDO_SECRET_KEY")) return "Credo";
  if (v(env, "PAYSTACK_SECRET_KEY")) return "Paystack";
  return "";
}

const credoApi = (env) => (v(env, "CREDO_LIVE") === "1" ? "https://api.credocentral.com" : "https://api.credodemo.com");
const paystackHeaders = (env) => ({ Authorization: `Bearer ${v(env, "PAYSTACK_SECRET_KEY")}`, "content-type": "application/json" });
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

function randomHex(bytes) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function json(r) {
  try { return await r.json(); } catch { return {}; }
}

export async function startCheckout(env, email, subscriberId, callbackUrl) {
  const reference = `ja${subscriberId}x${randomHex(8)}`;
  const amount = priceNgn(env) * 100; // kobo
  let r, url, data;
  if (provider(env) === "Credo") {
    r = await fetch(`${credoApi(env)}/transaction/initialize`, {
      method: "POST",
      headers: { Authorization: v(env, "CREDO_PUBLIC_KEY"), "content-type": "application/json" },
      body: JSON.stringify({ amount, email, currency: "NGN", bearer: 1, channels: ["CARD", "BANK"], initializeAccount: 0,
        reference, callbackUrl, narration: `Job alerts, ${periodDays(env)} days` }),
    });
    data = await json(r);
    url = data?.data?.authorizationUrl;
  } else {
    r = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST", headers: paystackHeaders(env),
      body: JSON.stringify({ email, amount, currency: "NGN", reference, callback_url: callbackUrl }),
    });
    data = await json(r);
    url = data?.data?.authorization_url;
  }
  if (!url) throw new Error(`${provider(env)} initialize failed: ${r.status} ${data?.message}`);
  return url;
}

// `ref` is whatever the provider sent back (Credo's transRef, Paystack's reference).
// Returns { reference, subscriberId, amount } for a completed, full payment, else null.
export async function verify(env, ref) {
  if (!ref) return null;
  const q = encodeURIComponent(ref);
  const price = priceNgn(env);
  let ok, reference, amount, r;
  if (provider(env) === "Credo") {
    r = await fetch(`${credoApi(env)}/transaction/${q}/verify`, { headers: { Authorization: v(env, "CREDO_SECRET_KEY") } });
    const d = (await json(r))?.data || {};
    // status 0 = successful. transAmount is in kobo like the amount we sent; a naira
    // figure equal to the price is also accepted, as Credo's docs don't state the unit.
    const paid = Number(d.transAmount || 0);
    ok = d.status === 0 && d.currencyCode === "NGN" && (paid >= price * 100 || paid === price);
    reference = d.businessRef;
    amount = price;
  } else {
    r = await fetch(`https://api.paystack.co/transaction/verify/${q}`, { headers: paystackHeaders(env) });
    const d = (await json(r))?.data || {};
    ok = d.status === "success" && d.currency === "NGN" && Number(d.amount || 0) >= price * 100;
    reference = d.reference;
    amount = Math.floor(Number(d.amount || 0) / 100);
  }
  const m = REF_RE.exec(reference || "");
  if (!ok || !m) {
    console.log(`[verify] ${provider(env)} ${ref}: not a completed payment (${r.status})`);
    return null;
  }
  return { reference, subscriberId: parseInt(m[1], 10), amount };
}

// Checks a webhook came from the provider; returns the reference to verify, or
// null for events we ignore. Throws on a bad signature.
export async function webhookRef(env, body, headers) {
  const event = JSON.parse(body || "{}");
  const data = event.data || {};
  if (provider(env) === "Credo") {
    const code = v(env, "CREDO_BUSINESS_CODE") || String(data.businessCode ?? event.businessCode ?? "");
    const expected = hex(await crypto.subtle.digest("SHA-512", new TextEncoder().encode(v(env, "CREDO_SECRET_KEY") + code)));
    const got = (headers.get("x-credo-signature") || headers.get("credo-signature") || "").toLowerCase();
    if (!timingSafeEqual(expected, got)) throw new Error("bad signature");
    return event.event === "transaction.successful" ? data.transRef : null;
  }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(v(env, "PAYSTACK_SECRET_KEY")),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  if (!timingSafeEqual(expected, headers.get("x-paystack-signature") || "")) throw new Error("bad signature");
  return event.event === "charge.success" ? data.reference : null;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
