"""Paystack payments: one ₦5,000 payment buys 3 months of alerts. Nothing renews
automatically; subscribers get a reminder email with a renew link before it ends.

Env: PAYSTACK_SECRET_KEY (sk_test_... while testing, sk_live_... to take real
money), PRICE_NGN (default 5000), PERIOD_DAYS (default 90).
Paystack dashboard → Settings → API Keys & Webhooks: set the webhook URL to
<BASE_URL>/payments/webhook so payments are recorded even if the buyer closes
the page before returning to the site.
"""
import hashlib
import hmac
import os
import secrets

import requests

API = "https://api.paystack.co"
PRICE_NGN = int(os.environ.get("PRICE_NGN", "5000"))
PERIOD_DAYS = int(os.environ.get("PERIOD_DAYS", "90"))


def _key() -> str:
    return (os.environ.get("PAYSTACK_SECRET_KEY") or "").strip()


def enabled() -> bool:
    return bool(_key())


def _headers() -> dict:
    return {"Authorization": f"Bearer {_key()}", "Content-Type": "application/json"}


def start_checkout(email: str, token: str, callback_url: str) -> str:
    """Creates a Paystack transaction and returns the checkout page to send the buyer to."""
    reference = f"ja_{secrets.token_hex(10)}"
    r = requests.post(f"{API}/transaction/initialize", headers=_headers(), timeout=20, json={
        "email": email, "amount": PRICE_NGN * 100, "currency": "NGN", "reference": reference,
        "callback_url": callback_url, "metadata": {"token": token},
    })
    data = r.json()
    if not data.get("status"):
        raise RuntimeError(f"Paystack initialize failed: {r.status_code} {data.get('message')}")
    return data["data"]["authorization_url"]


def verify(reference: str) -> dict | None:
    """Asks Paystack (never the browser) whether this payment succeeded in full.
    Returns {"reference", "token", "amount"} for a good payment, else None."""
    r = requests.get(f"{API}/transaction/verify/{requests.utils.quote(reference, safe='')}", headers=_headers(), timeout=20)
    data = (r.json() or {}).get("data") or {}
    if data.get("status") != "success" or data.get("currency") != "NGN" or (data.get("amount") or 0) < PRICE_NGN * 100:
        return None
    token = (data.get("metadata") or {}).get("token") if isinstance(data.get("metadata"), dict) else None
    return {"reference": data.get("reference"), "token": token, "amount": data["amount"] // 100} if token else None


def signature_ok(raw_body: bytes, signature: str) -> bool:
    expected = hmac.new(_key().encode(), raw_body, hashlib.sha512).hexdigest()
    return bool(signature) and hmac.compare_digest(expected, signature)
