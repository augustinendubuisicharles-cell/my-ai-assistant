"""Saves every exchange with your assistant to me/notes/conversations/, so it can
recall what you've talked about before, not just your profile and notes.

These transcripts are indexed into memory (assistant/memory.py already scans every
.md file under me/notes/) at each app start, and any time you press "Reindex now"
in More -> Remember / profile. They're kept out of git (see .gitignore) since
they're personal and grow over time.
"""
from datetime import date, datetime
from pathlib import Path


def log_exchange(cfg: dict, user_text: str, assistant_text: str) -> None:
    user_text, assistant_text = user_text.strip(), assistant_text.strip()
    if not user_text or not assistant_text:
        return
    log_dir: Path = cfg["notes_dir"] / "conversations"
    log_dir.mkdir(parents=True, exist_ok=True)
    path = log_dir / f"{date.today().isoformat()}.md"
    if not path.exists():
        path.write_text(f"# Conversation on {date.today().isoformat()}\n", encoding="utf-8")
    with open(path, "a", encoding="utf-8") as f:
        f.write(f"\n### {datetime.now():%H:%M}\n- You: {user_text}\n- Assistant: {assistant_text}\n")
