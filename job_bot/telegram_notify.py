"""Sends the daily job digest to your Telegram chat."""
import requests

TELEGRAM_LIMIT = 4096


def send_message(token: str, chat_id: str, text: str) -> None:
    """Sends `text` as one or more Telegram messages (split to stay under the length limit)."""
    chunks = [text[i : i + TELEGRAM_LIMIT] for i in range(0, len(text), TELEGRAM_LIMIT)] or [text]
    for chunk in chunks:
        resp = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": chunk, "parse_mode": "Markdown", "disable_web_page_preview": True},
            timeout=20,
        )
        resp.raise_for_status()
