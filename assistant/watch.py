"""Watches what you do on your computer and keeps a private daily activity log
in me/notes/activity/YYYY-MM-DD.md, which your assistant can then use.

    python -m assistant.watch            # start watching (Ctrl+C to stop)
    python -m assistant.watch pause      # pause until you resume
    python -m assistant.watch resume

Screenshots stay in memory only and are never written to disk. Windows matching
the `ignore` list in config.yaml (password managers, banking, private browsing)
are skipped entirely.
"""
import sys
import time
from datetime import datetime

from .config import ROOT, load_config

PAUSE_FILE = ROOT / "me/.watch-paused"
VISION_PROMPT = (
    "This is a screenshot of my computer. In one or two sentences, describe what I am "
    "doing (app, task, topic). Do not copy any passwords, account numbers, or private "
    "messages word for word."
)


def active_window() -> tuple[str, str] | None:
    """Return (app name, window title) of the focused window, or None."""
    try:
        import pywinctl

        win = pywinctl.getActiveWindow()
        if not win:
            return None
        return (win.getAppName() or "?").strip(), (win.title or "").strip()
    except Exception:
        return None


class ActivityLog:
    def __init__(self, cfg: dict):
        self.dir = cfg["watch"]["activity_dir"]
        self.dir.mkdir(parents=True, exist_ok=True)
        self.current: tuple[str, str] | None = None
        self.since = datetime.now()

    def _write(self, line: str, when: datetime) -> None:
        path = self.dir / f"{when.date().isoformat()}.md"
        if not path.exists():
            path.write_text(f"# Activity on {when.date().isoformat()}\n", encoding="utf-8")
        with open(path, "a", encoding="utf-8") as f:
            f.write(line + "\n")

    def switch(self, window: tuple[str, str] | None) -> None:
        """Record the previous window with how long it was used, once focus moves on."""
        if window == self.current:
            return
        now = datetime.now()
        if self.current:
            minutes = (now - self.since).total_seconds() / 60
            if minutes >= 0.5:  # skip quick alt-tabs
                app, title = self.current
                self._write(f"- {self.since:%H:%M} [{app}] {title} ({minutes:.0f} min)", self.since)
        self.current, self.since = window, now

    def note(self, text: str) -> None:
        now = datetime.now()
        self._write(f"- {now:%H:%M} (screen) {text}", now)


class ScreenDescriber:
    """Looks at a screenshot with a local vision-language model."""

    def __init__(self, model_id: str):
        import torch
        from transformers import AutoModelForImageTextToText, AutoProcessor

        self.torch = torch
        self.processor = AutoProcessor.from_pretrained(model_id)
        self.model = AutoModelForImageTextToText.from_pretrained(
            model_id, torch_dtype="auto", device_map="auto"
        ).eval()

    def describe(self) -> str:
        import mss
        from PIL import Image

        with mss.mss() as sct:
            shot = sct.grab(sct.monitors[1])
            image = Image.frombytes("RGB", shot.size, shot.rgb)
        image.thumbnail((1280, 1280))
        messages = [{"role": "user", "content": [
            {"type": "image", "image": image},
            {"type": "text", "text": VISION_PROMPT},
        ]}]
        inputs = self.processor.apply_chat_template(
            messages, add_generation_prompt=True, tokenize=True,
            return_dict=True, return_tensors="pt",
        ).to(self.model.device)
        with self.torch.no_grad():
            out = self.model.generate(**inputs, max_new_tokens=120, do_sample=False)
        text = self.processor.decode(out[0, inputs["input_ids"].shape[1]:], skip_special_tokens=True)
        return " ".join(text.split())


def is_ignored(window: tuple[str, str] | None, ignore: list[str]) -> bool:
    if not window:
        return False
    hay = f"{window[0]} {window[1]}".lower()
    return any(word.lower() in hay for word in ignore)


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] in ("pause", "resume"):
        if sys.argv[1] == "pause":
            PAUSE_FILE.touch()
            print("Screen watching paused. Run `python -m assistant.watch resume` to continue.")
        else:
            PAUSE_FILE.unlink(missing_ok=True)
            print("Screen watching resumed.")
        return

    cfg = load_config()
    w = cfg["watch"]
    log = ActivityLog(cfg)
    describer = None
    if w["mode"] == "vision":
        print(f"Loading vision model {w['vision_model']}...")
        describer = ScreenDescriber(w["vision_model"])
    if active_window() is None:
        print("Note: can't read the active window. On macOS allow Accessibility and Screen "
              "Recording for your terminal (System Settings > Privacy & Security).")
    print(f"Watching (mode: {w['mode']}). Log: {w['activity_dir']}. Ctrl+C to stop.")

    last_look = 0.0
    try:
        while True:
            if PAUSE_FILE.exists():
                log.switch(None)
                time.sleep(w["check_every_seconds"])
                continue
            window = active_window()
            ignored = is_ignored(window, w["ignore"])
            log.switch(None if ignored else window)
            if describer and not ignored and time.time() - last_look >= w["vision_every_seconds"]:
                last_look = time.time()
                try:
                    log.note(describer.describe())
                except Exception as e:
                    print(f"(couldn't look at the screen: {e})")
            time.sleep(w["check_every_seconds"])
    except KeyboardInterrupt:
        log.switch(None)
        print("\nStopped.")


if __name__ == "__main__":
    main()
