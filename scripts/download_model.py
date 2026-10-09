"""Download the open model weights from Hugging Face into models/base.

    python scripts/download_model.py                 # model from config.yaml
    python scripts/download_model.py Qwen/Qwen3-4B   # or any other model id
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from huggingface_hub import snapshot_download

from assistant.config import load_config

cfg = load_config()
model_id = sys.argv[1] if len(sys.argv) > 1 else cfg["model_id"]
print(f"Downloading {model_id} -> {cfg['model_dir']} (several GB, one time only)")
snapshot_download(
    model_id,
    local_dir=cfg["model_dir"],
    allow_patterns=["*.json", "*.safetensors", "*.txt", "*.model", "*.tiktoken", "*.py"],
)
print("Done.")
