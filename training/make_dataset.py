"""Build the fine-tuning dataset (training/dataset.jsonl) from:
  1. training/examples.jsonl  - conversations you write: how you want the assistant to answer
  2. me/profile.md             - each "## Section" becomes a Q&A pair about you

Fine-tuning mostly teaches *style and personality*; facts are better served by the
memory (RAG) system, which stays up to date without retraining.
"""
import json
import random
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from assistant.config import ROOT, load_config

QUESTIONS = [
    "What do you know about my {h}?",
    "Remind me about my {h}.",
    "Tell me about my {h}.",
]


def profile_pairs(profile: str) -> list[dict]:
    pairs = []
    for section in re.split(r"^## ", profile, flags=re.M)[1:]:
        heading, _, body = section.partition("\n")
        body = re.sub(r"<!--.*?-->", "", body, flags=re.S).strip()
        lines = [l for l in body.splitlines() if l.strip() and not re.fullmatch(r"-\s*[^:]+:\s*", l)]
        if not lines:
            continue  # section not filled in yet
        for q in QUESTIONS:
            pairs.append({"messages": [
                {"role": "user", "content": q.format(h=heading.strip().lower())},
                {"role": "assistant", "content": "Here's what I know:\n" + "\n".join(lines)},
            ]})
    return pairs


def main() -> None:
    cfg = load_config()
    rows = []
    ex = ROOT / "training/examples.jsonl"
    for line in ex.read_text(encoding="utf-8").splitlines():
        if line.strip() and "REPLACE ME" not in line:
            rows.append(json.loads(line))
    if cfg["profile_file"].exists():
        rows += profile_pairs(cfg["profile_file"].read_text(encoding="utf-8"))
    random.shuffle(rows)
    out = ROOT / "training/dataset.jsonl"
    out.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
    print(f"Wrote {len(rows)} examples to {out}")
    if len(rows) < 50:
        print("Tip: aim for 100+ examples in training/examples.jsonl for a noticeable effect.")


if __name__ == "__main__":
    main()
