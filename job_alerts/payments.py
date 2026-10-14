"""Payments: one ₦5,000 payment buys 3 months of alerts. Nothing renews
automatically; subscribers get a reminder email with a renew link before it ends.

Works with Credo (eTranzact) or Paystack, whichever has keys set (Credo wins if both):
  Credo:    CREDO_PUBLIC_KEY + CREDO_SECRET_KEY, and CREDO_LIVE=1 for real money
            (otherwise the sandbox, api.credodemo.com). Dashboard → Settings →
            Webhooks: <BASE_URL>/payments/webhook
  Paystack: PAYSTACK_SECRET_KEY (sk_test_... or sk_live_...). Dashboard → Settings
            → API Keys & Webhooks: <BASE_URL>/payments/webhook
Also: PRICE_NGN (default 5000), PERIOD_DAYS (default 90), TRIAL_DAYS (default 7).

Every payment is re-checked with the provider's API before it counts; the
browser return and the webhook are only hints to go and check.
"""
import hashlib
import hmac
import json
import os
import re
import secrets

import requests

PRICE_NGN = int(os.environ.get("PRICE_NGN", "5000"))
PERIOD_DAYS = int(os.environ.get("PERIOD_DAYS", "90"))
TRIAL_DAYS = int(os.environ.get("TRIAL_DAYS", "7"))  # free days everyone gets when they confirm their email
# What each plan gets per daily email: (jobs, job titles searched). Paid members also get Telegram alerts.
TRIAL_LIMITS = (3, 2)  # jobs a day, job titles searched
PAID_LIMITS = (10, 5)
DAILY_MINIMUM = {True: 5, False: 3}  # members, trial: similar roles fill any gap (search.find_jobs)


def limits(member: bool) -> tuple[int, int]:
    return PAID_LIMITS if member else TRIAL_LIMITS
REF_RE = re.compile(r"^ja(\d+)x[0-9a-f]+$")  # our reference: ja<subscriber id>x<random>


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def provider() -> str:
    if _env("CREDO_PUBLIC_KEY") and _env("CREDO_SECRET_KEY"):
        return "Credo"
    if _env("PAYSTACK_SECRET_KEY"):
        return "Paystack"
    return ""


def enabled() -> bool:
    return bool(provider())


def _subscriber_id(reference: str | None) -> int | None:
    m = REF_RE.match(reference or "")
    return int(m.group(1)) if m else None


def start_checkout(email: str, subscriber_id: int, callback_url: str) -> str:
    """Creates a transaction and returns the provider's checkout page to send the buyer to."""
    reference = f"ja{subscriber_id}x{secrets.token_hex(8)}"
    if provider() == "Credo":
        r = requests.post(f"{_credo_api()}/transaction/initialize", timeout=20,
                          headers={"Authorization": _env("CREDO_PUBLIC_KEY"), "Content-Type": "application/json"},
                          json={"amount": PRICE_NGN * 100, "email": email, "currency": "NGN", "bearer": 1,
                                "channels": ["CARD", "BANK"], "initializeAccount": 0, "reference": reference,
                                "callbackUrl": callback_url, "narration": f"Job alerts, {PERIOD_DAYS} days"})
        data = r.json() if r.content else {}
        url = (data.get("data") or {}).get("authorizationUrl")
    else:
        r = requests.post("https://api.paystack.co/transaction/initialize", timeout=20, headers=_paystack_headers(),
                          json={"email": email, "amount": PRICE_NGN * 100, "currency": "NGN", "reference": reference,
                                "callback_url": callback_url})
        data = r.json() if r.content else {}
        url = (data.get("data") or {}).get("authorization_url")
    if not url:
        raise RuntimeError(f"{provider()} initialize failed: {r.status_code} {data.get('message')}")
    return url


def verify(ref: str) -> dict | None:
    """Asks the provider whether this payment succeeded in full. `ref` is whatever the
    provider sent back (Credo's transRef, Paystack's reference). Returns
    {"reference", "subscriber_id", "amount"} for a good payment, else None."""
    if not ref:
        return None
    quoted = requests.utils.quote(ref, safe="")
    if provider() == "Credo":
        r = requests.get(f"{_credo_api()}/transaction/{quoted}/verify", timeout=20,
                         headers={"Authorization": _env("CREDO_SECRET_KEY")})
        d = ((r.json() if r.content else {}) or {}).get("data") or {}
        # status 0 = successful. transAmount is in kobo like the amount we sent (Credo's docs show
        # the same number in both); a naira figure equal to the price is also accepted, just in case.
        paid = d.get("transAmount") or 0
        ok = d.get("status") == 0 and d.get("currencyCode") == "NGN" and (paid >= PRICE_NGN * 100 or paid == PRICE_NGN)
        reference, amount = d.get("businessRef"), PRICE_NGN
    else:
        r = requests.get(f"https://api.paystack.co/transaction/verify/{quoted}", timeout=20, headers=_paystack_headers())
        d = ((r.json() if r.content else {}) or {}).get("data") or {}
        ok = d.get("status") == "success" and d.get("currency") == "NGN" and (d.get("amount") or 0) >= PRICE_NGN * 100
        reference, amount = d.get("reference"), (d.get("amount") or 0) // 100
    sub_id = _subscriber_id(reference)
    if not ok or sub_id is None:
        print(f"[verify] {provider()} {ref}: not a completed payment ({r.status_code})")
        return None
    return {"reference": reference, "subscriber_id": sub_id, "amount": amount}


def webhook_ref(body: bytes, headers) -> str | None:
    """Checks a webhook really came from the provider and returns the payment
    reference to verify (None for other events). Raises PermissionError on a bad signature."""
    if provider() == "Credo":
        event = json.loads(body or b"{}")
        data = event.get("data") or {}
        code = _env("CREDO_BUSINESS_CODE") or str(data.get("businessCode") or event.get("businessCode") or "")
        expected = hashlib.sha512((_env("CREDO_SECRET_KEY") + code).encode()).hexdigest()
        if not hmac.compare_digest(expected, (headers.get("x-credo-signature") or headers.get("credo-signature") or "").lower()):
            raise PermissionError("bad Credo signature")
        return data.get("transRef") if event.get("event") == "transaction.successful" else None
    expected = hmac.new(_env("PAYSTACK_SECRET_KEY").encode(), body, hashlib.sha512).hexdigest()
    if not hmac.compare_digest(expected, headers.get("x-paystack-signature") or ""):
        raise PermissionError("bad Paystack signature")
    event = json.loads(body)
    return (event.get("data") or {}).get("reference") if event.get("event") == "charge.success" else None


def _credo_api() -> str:
    return "https://api.credocentral.com" if _env("CREDO_LIVE") == "1" else "https://api.credodemo.com"


def _paystack_headers() -> dict:
    return {"Authorization": f"Bearer {_env('PAYSTACK_SECRET_KEY')}", "Content-Type": "application/json"}
