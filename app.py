"""Desktop-style app for your assistant. Opens in your web browser, runs only on your computer.

    python app.py
"""
import atexit
import shutil
import subprocess
import sys
from pathlib import Path

import gradio as gr

from assistant.chat import chat_reply, explain, today
from assistant.config import ROOT, load_config
from assistant.memory import Memory
from assistant.model import load_model
from assistant.watch import PAUSE_FILE

cfg = load_config()
memory = Memory(cfg)
memory.build()
print("Loading model (first run downloads it)...")
tok, model = load_model(cfg)
NAME = cfg["assistant_name"]
watcher: subprocess.Popen | None = None
atexit.register(lambda: watcher and watcher.poll() is None and watcher.terminate())


def history_for_model(chat: list[dict]) -> list[dict]:
    return [{"role": m["role"], "content": m["content"]} for m in chat if isinstance(m.get("content"), str)]


def send(msg: str, chat: list[dict]):
    msg = msg.strip()
    if not msg:
        return "", chat
    reply = chat_reply(cfg, memory, tok, model, history_for_model(chat), msg)
    return "", chat + [{"role": "user", "content": msg}, {"role": "assistant", "content": reply}]


def explain_it(file, link: str, question: str, chat: list[dict]):
    src = file if file else link.strip()
    if not src:
        gr.Warning("Drop a file or paste a link first.")
        return chat, None, link, question
    try:
        asked, reply = explain(cfg, memory, tok, model, f'"{src}" {question}')
    except Exception as e:
        gr.Warning(f"Couldn't read that: {e}")
        return chat, file, link, question
    return chat + [{"role": "user", "content": asked}, {"role": "assistant", "content": reply}], None, "", ""


def recap(chat: list[dict]):
    asked, reply = today(cfg, memory, tok, model, "")
    return chat + [{"role": "user", "content": "Recap my day"}, {"role": "assistant", "content": reply}]


def remember(fact: str):
    if fact.strip():
        memory.remember(fact)
        gr.Info("Saved. I'll remember that.")
    return ""


def load_profile() -> str:
    path = cfg["profile_file"]
    return path.read_text(encoding="utf-8") if path.exists() else ""


def save_profile(text: str):
    cfg["profile_file"].write_text(text, encoding="utf-8")
    memory.build()
    gr.Info("Profile saved.")


def add_notes(files):
    for f in files or []:
        shutil.copy(f, cfg["notes_dir"] / Path(f).name)
    n = memory.build()
    gr.Info(f"Added {len(files or [])} file(s). Memory now has {n} pieces.")
    return None


def watch_status() -> str:
    running = watcher is not None and watcher.poll() is None
    if not running:
        return "Screen watching is **off**."
    if PAUSE_FILE.exists():
        return "Screen watching is **paused**."
    return f"Screen watching is **on** ({cfg['watch']['mode']} mode)."


def toggle_watch(action: str) -> str:
    global watcher
    running = watcher is not None and watcher.poll() is None
    if action == "start" and not running:
        PAUSE_FILE.unlink(missing_ok=True)
        watcher = subprocess.Popen([sys.executable, "-m", "assistant.watch"], cwd=ROOT)
    elif action == "stop" and running:
        watcher.terminate()
        watcher.wait(timeout=10)
    elif action == "pause":
        PAUSE_FILE.touch()
    elif action == "resume":
        PAUSE_FILE.unlink(missing_ok=True)
    return watch_status()


with gr.Blocks(title=NAME) as demo:
    gr.Markdown(f"# {NAME}\nYour personal assistant. Runs privately on this computer.")
    with gr.Tab("Chat"):
        with gr.Row():
            with gr.Column(scale=3):
                chatbot = gr.Chatbot(height=520, label=NAME)
                box = gr.Textbox(placeholder="Message " + NAME + "...", show_label=False, autofocus=True)
                with gr.Row():
                    send_btn = gr.Button("Send", variant="primary")
                    clear_btn = gr.Button("New chat")
            with gr.Column(scale=2):
                gr.Markdown("### Explain something")
                file_in = gr.File(label="Drop a PDF, Word doc or text file",
                                  file_types=[".pdf", ".docx", ".txt", ".md", ".csv", ".py", ".json"])
                link_in = gr.Textbox(label="...or paste a web link")
                q_in = gr.Textbox(label="Question (optional)", placeholder="Explain it simply")
                explain_btn = gr.Button("Explain it")
                gr.Markdown("### My day")
                recap_btn = gr.Button("Recap my day")
                status = gr.Markdown(watch_status())
                with gr.Row():
                    for label, action in [("Start", "start"), ("Pause", "pause"), ("Resume", "resume"), ("Stop", "stop")]:
                        gr.Button(label, size="sm").click(lambda a=action: toggle_watch(a), None, status)
                gr.Markdown("### Remember")
                fact_in = gr.Textbox(show_label=False, placeholder="e.g. My exam is on 3 November")
                remember_btn = gr.Button("Remember this")

        box.submit(send, [box, chatbot], [box, chatbot])
        send_btn.click(send, [box, chatbot], [box, chatbot])
        clear_btn.click(lambda: [], None, chatbot)
        explain_btn.click(explain_it, [file_in, link_in, q_in, chatbot], [chatbot, file_in, link_in, q_in])
        recap_btn.click(recap, chatbot, chatbot)
        remember_btn.click(remember, fact_in, fact_in)
        fact_in.submit(remember, fact_in, fact_in)

    with gr.Tab("About me"):
        gr.Markdown("Everything here is what " + NAME + " knows about you on every message.")
        profile_box = gr.Textbox(value=load_profile, lines=28, show_label=False)
        gr.Button("Save profile", variant="primary").click(save_profile, profile_box, None)
        gr.Markdown("### Add notes\nJournals, project docs, saved chats: anything it should know.")
        notes_in = gr.File(file_count="multiple", file_types=[".md", ".txt"], label="Drop .md or .txt files")
        notes_in.upload(add_notes, notes_in, notes_in)

if __name__ == "__main__":
    demo.launch(server_name="127.0.0.1", inbrowser=True)
