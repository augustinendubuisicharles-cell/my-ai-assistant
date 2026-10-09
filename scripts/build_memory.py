"""Re-index everything in me/ (run after editing your profile or notes)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from assistant.config import load_config
from assistant.memory import Memory

n = Memory(load_config()).build()
print(f"Indexed {n} chunks from me/")
