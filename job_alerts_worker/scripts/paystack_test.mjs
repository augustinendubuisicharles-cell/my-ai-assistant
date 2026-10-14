// Test payment against Paystack's TEST mode, using the site's own payment code.
// Run by the "Job alerts -- Paystack test payment" workflow; never touches the live site or database.
import * as payments from "../src/payments.js";

const key = (process.env.PAYSTACK_TEST_SECRET_KEY || "").trim();
if (!key.startsWith("sk_test_")) {
  console.log("PAYSTACK_TEST_SECRET_KEY must be a Paystack TEST secret key (sk_test_...).");
  process.exit(1);
}
const env = { PAYSTACK_SECRET_KEY: key };
const email = process.env.EMAIL || "test@jobalert.me.uk";
const step = (ok, text) => console.log(`${ok ? "PASS" : "FAIL"}  ${text}`);
let failed = false;
const check = (ok, text) => { step(ok, text); if (!ok) failed = true; return ok; };

// 1. The checkout page a subscriber is sent to.
const url = await payments.startCheckout(env, email, 1, "https://jobalert.me.uk/paid");
check(url.startsWith("https://checkout.paystack.com/"), `checkout page created: ${url}`);

// 2. Pay ₦5,000 with Paystack's test card (test mode only; no real money).
const reference = `ja1x${Date.now().toString(16)}`;
const r = await fetch("https://api.paystack.co/charge", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
  body: JSON.stringify({ email, amount: payments.priceNgn(env) * 100, reference,
    card: { number: "4084084084084081", cvv: "408", expiry_month: "12", expiry_year: "2030" } }),
});
let charge = await r.json().catch(() => ({}));
// Some test cards ask for a PIN or OTP first; Paystack's test values are 0000 and 123456.
for (const [status, path, field, value] of [["send_pin", "submit_pin", "pin", "0000"], ["send_otp", "submit_otp", "otp", "123456"]]) {
  if (charge?.data?.status !== status) continue;
  charge = await (await fetch(`https://api.paystack.co/charge/${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ [field]: value, reference }),
  })).json().catch(() => ({}));
}
check(charge?.data?.status === "success", `test card payment: ${charge?.data?.status || charge?.message || r.status}`);

// 3. The site's check before it gives membership.
const paid = await payments.verify(env, reference);
check(paid && paid.subscriberId === 1 && paid.amount === payments.priceNgn(env),
  `site accepts the payment: ${paid ? `₦${paid.amount.toLocaleString("en")} for subscriber ${paid.subscriberId}` : "rejected"}`);

// 4. The webhook Paystack sends after a payment: a correctly signed one is accepted, a forged one refused.
const body = JSON.stringify({ event: "charge.success", data: { reference } });
const sig = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
const good = [...new Uint8Array(await crypto.subtle.sign("HMAC", sig, new TextEncoder().encode(body)))]
  .map((b) => b.toString(16).padStart(2, "0")).join("");
check(await payments.webhookRef(env, body, new Headers({ "x-paystack-signature": good })) === reference, "signed webhook accepted");
let forged = false;
try { await payments.webhookRef(env, body, new Headers({ "x-paystack-signature": "0".repeat(128) })); } catch { forged = true; }
check(forged, "forged webhook refused");

console.log(failed ? "\nSome steps failed." : "\nAll steps passed.");
process.exit(failed ? 1 : 0);
