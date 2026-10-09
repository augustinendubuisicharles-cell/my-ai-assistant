from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent


def load_config(path: str | Path = ROOT / "config.yaml") -> dict:
    with open(path) as f:
        cfg = yaml.safe_load(f)
    for key in ("model_dir", "profile_file", "notes_dir", "index_dir"):
        cfg[key] = ROOT / cfg[key]
    if cfg.get("watch"):
        cfg["watch"]["activity_dir"] = ROOT / cfg["watch"]["activity_dir"]
    if cfg.get("adapter_dir"):
        cfg["adapter_dir"] = ROOT / cfg["adapter_dir"]
    return cfg
