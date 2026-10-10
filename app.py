"""Desktop-style app for your assistant. Opens in your web browser, runs only on your computer.

    python app.py

By default it listens continuously and answers whenever you say its name
("Signal, ...") -- no typing or button-pressing needed. Say "Signal" followed
by what you want, and it replies in the chat and out loud.
"""
import atexit
import os
import shutil
import subprocess
import sys
from pathlib import Path

import gradio as gr

from assistant.audio import to_whisper_input
from assistant.chat import chat_reply, explain, today
from assistant.conversation_log import log_exchange
from assistant.config import ROOT, load_config
from assistant.memory import Memory
from assistant.model import load_model
from assistant.watch import PAUSE_FILE

# True when running as a Hugging Face Space: screen watching makes no sense there
# (it would watch the server's screen, not yours), and Spaces needs its own launch setup.
ON_SPACES = bool(os.environ.get("SPACE_ID"))

cfg = load_config()
memory = Memory(cfg)
memory.build()
print("Loading model (first run downloads it)...")
tok, model = load_model(cfg)
NAME = cfg["assistant_name"]
watcher: subprocess.Popen | None = None
atexit.register(lambda: watcher and watcher.poll() is None and watcher.terminate())


def text_of(content) -> str:
    """Gradio 6 returns message content as a list of parts; older versions as a string."""
    if isinstance(content, str):
        return content
    return "".join(p.get("text", "") for p in content or [] if isinstance(p, dict))


def history_for_model(chat: list[dict]) -> list[dict]:
    return [{"role": m["role"], "content": text_of(m["content"])} for m in chat if text_of(m["content"])]


def send(msg: str, chat: list[dict]):
    msg = msg.strip()
    if not msg:
        return "", chat
    reply = chat_reply(cfg, memory, tok, model, history_for_model(chat), msg)
    log_exchange(cfg, msg, reply)
    return "", chat + [{"role": "user", "content": msg}, {"role": "assistant", "content": reply}]


_whisper = None


def transcribe(recording) -> str:
    """Speech to text, locally, with faster-whisper. `recording` is (sample_rate, samples)."""
    global _whisper
    if recording is None:
        return ""
    if _whisper is None:
        from faster_whisper import WhisperModel

        _whisper = WhisperModel(cfg.get("voice", {}).get("whisper_model", "small"), compute_type="int8")
    sample_rate, data = recording
    segments, _ = _whisper.transcribe(to_whisper_input(sample_rate, data))
    return " ".join(seg.text.strip() for seg in segments)


def voice_send(recording, chat: list[dict]):
    """Fallback push-to-talk mic (used if the browser can't do always-on listening)."""
    text = transcribe(recording)
    if not text:
        gr.Warning("I didn't catch that. Try again?")
        return None, chat
    _, chat = send(text, chat)
    return None, chat


def explain_it(file, link: str, question: str, chat: list[dict], progress=gr.Progress()):
    src = file if file else link.strip()
    if not src:
        gr.Warning("Drop a file or paste a link first.")
        return chat, None, link, question
    progress(0, desc="Reading...")
    try:
        asked, reply = explain(cfg, memory, tok, model, f'"{src}" {question}', progress=progress)
    except Exception as e:
        gr.Warning(f"Couldn't read that: {e}")
        return chat, file, link, question
    log_exchange(cfg, asked, reply)
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
        return "off"
    return "paused" if PAUSE_FILE.exists() else "on"


def toggle_watch(action: str) -> None:
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


def set_watch(choice: str) -> str:
    """One three-way control (Off/On/Paused) instead of four separate buttons."""
    if choice == "On":
        toggle_watch("start" if watch_status() == "off" else "resume")
    elif choice == "Paused":
        if watch_status() == "off":
            toggle_watch("start")
        toggle_watch("pause")
    else:
        toggle_watch("stop")
    return f"Screen watching: **{choice}**" + (f" ({cfg['watch']['mode']} mode)" if choice == "On" else "")


_WATCH_LABEL = {"off": "Off", "on": "On", "paused": "Paused"}

# Reads the newest reply out loud with the computer's built-in voice (stays on your device),
# and pauses the always-listening mic while speaking so it doesn't hear itself.
SPEAK_JS = """(chat, on) => {
  if (!chat || !chat.length) return;
  const last = chat[chat.length - 1];
  if (last.role !== "assistant") return;
  const c = last.content;
  const text = typeof c === "string" ? c : (c || []).map(p => p.text || "").join(" ");
  const sig = window.__signal;
  if (sig && sig.recognition) { try { sig.recognition.stop(); } catch (e) {} }
  if (!on) { if (sig && sig.enabled) setTimeout(() => sig.resume && sig.resume(), 200); return; }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text.replace(/[*#`_>]/g, ""));
  const chosen = (window.speechSynthesis.getVoices() || []).find((v) => v.name === (sig && sig.voiceName));
  if (chosen) { try { utter.voice = chosen; } catch (e) {} }
  utter.onend = () => { if (sig && sig.enabled) setTimeout(() => sig.resume && sig.resume(), 200); };
  window.speechSynthesis.speak(utter);
}"""

# Picks the most natural-sounding voice your computer already has (no download, no cloning)
# and lets you override it from the dropdown in More -> Voice.
VOICE_JS = """() => {
  const sig = window.__signal = window.__signal || { enabled: true, recognition: null };
  function populate() {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;
    const select = document.querySelector('#voice_select');
    if (select && !select.dataset.filled) {
      select.dataset.filled = '1';
      voices.filter((v) => v.lang.startsWith('en')).forEach((v) => {
        const opt = document.createElement('option');
        opt.value = v.name;
        opt.textContent = v.name + (v.localService ? '' : ' (online)');
        select.appendChild(opt);
      });
      select.addEventListener('change', () => { sig.voiceName = select.value; });
    }
    if (!sig.voiceName) {
      const best = voices.find((v) => v.name.includes('Natural'))
        || voices.find((v) => v.lang === 'en-US' && !v.localService)
        || voices.find((v) => v.lang.startsWith('en'))
        || voices[0];
      if (best) { sig.voiceName = best.name; if (select) select.value = best.name; }
    }
  }
  populate();
  window.speechSynthesis.onvoiceschanged = populate;
  // The dropdown lives inside More -> Voice, which Gradio only mounts once opened.
  new MutationObserver(populate).observe(document.body, { childList: true, subtree: true });
}"""

# Always-on listening: uses the browser's built-in speech recognition (continuous),
# waits for the assistant's name, then sends whatever follows it, hands-free.
# Note: in Chrome this sends your speech to Google to be turned into text; it never
# leaves your computer otherwise. There's a push-to-talk mic in "More" if you'd rather not.
WAKE_JS = (
    """() => {
  const NAME = "%s";
  const statusEl = () => document.querySelector('#listen_status');
  const setStatus = (s) => { const e = statusEl(); if (e) e.textContent = s; };

  function hiddenInput(elemId) {
    const wrap = document.querySelector('#' + elemId);
    return wrap ? wrap.querySelector('textarea, input') : null;
  }
  function submitHidden(text) {
    const inp = hiddenInput('wake_box');
    const btn = document.querySelector('#wake_submit');
    if (!inp || !btn) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(inp, text);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    btn.click();
  }

  const sig = window.__signal = window.__signal || { enabled: true, recognition: null };

  function start() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setStatus('Always-on listening needs Chrome or Edge. Use the mic in "More" instead.'); return; }
    const r = new SR();
    sig.recognition = r;
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    r.onresult = (e) => {
      let finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      }
      if (!finalText) return;
      const idx = finalText.toLowerCase().indexOf(NAME);
      if (idx === -1) return;
      const said = finalText.slice(idx + NAME.length).replace(/^[,:\\s]+/, '').trim();
      if (!said) { setStatus('Yes?'); return; }
      setStatus('Thinking...');
      submitHidden(said);
    };
    r.onend = () => { if (sig.enabled) { try { r.start(); } catch (e) {} } };
    r.onerror = () => {};
    try { r.start(); setStatus('Listening for "' + NAME + '"...'); } catch (e) {}
  }
  sig.resume = start;

  const toggle = document.querySelector('#listen_toggle input');
  if (toggle) {
    toggle.addEventListener('change', () => {
      sig.enabled = toggle.checked;
      if (sig.enabled) start();
      else { if (sig.recognition) try { sig.recognition.stop(); } catch (e) {} setStatus('Muted'); }
    });
  }
  start();
}"""
    % NAME.lower()
)


with gr.Blocks(title=NAME) as demo:
    gr.Markdown(f"# {NAME}")
    with gr.Row():
        listen_toggle = gr.Checkbox(value=True, label="Listening", elem_id="listen_toggle", scale=0, min_width=120, interactive=True)
        speak_on = gr.Checkbox(value=True, label="Speaks", scale=0, min_width=120)
    listen_status = gr.Markdown(f'<span id="listen_status">Just say "{NAME}" any time.</span>')

    chatbot = gr.Chatbot(height=560, label=NAME, show_label=False)

    # Hidden plumbing the wake-word JS uses to hand text to Python, same as pressing Send.
    wake_box = gr.Textbox(elem_id="wake_box", elem_classes=["hidden-io"])
    wake_submit = gr.Button(elem_id="wake_submit", elem_classes=["hidden-io"])
    wake_submit.click(send, [wake_box, chatbot], [wake_box, chatbot])

    with gr.Accordion("More", open=False), gr.Tabs():
        with gr.Tab("Type / push-to-talk"):
            box = gr.Textbox(placeholder=f"Message {NAME}...", show_label=False)
            with gr.Row():
                send_btn = gr.Button("Send", variant="primary", size="sm")
                clear_btn = gr.Button("New chat", size="sm")
            mic = gr.Audio(sources=["microphone"], type="numpy", label="Or hold to talk")

        with gr.Tab("Explain something"):
            file_in = gr.File(label="Drop a PDF, Word doc or text file",
                              file_types=[".pdf", ".docx", ".txt", ".md", ".csv", ".py", ".json"])
            link_in = gr.Textbox(label="...or paste a web link")
            q_in = gr.Textbox(label="Question (optional)", placeholder="Explain it simply")
            explain_btn = gr.Button("Explain it")

        with gr.Tab("My day"):
            recap_btn = gr.Button("Recap my day")
            if ON_SPACES:
                gr.Markdown(
                    "**Screen watching** only works on your own computer, not here in the cloud "
                    "(it would be watching this server, not you). Run `python -m assistant.watch` "
                    "locally if you want that -- it writes to the same memory this app reads."
                )
                watch_radio = gr.Radio(["Off", "On", "Paused"], value="Off", visible=False)
                watch_status_md = gr.Markdown("", visible=False)
            else:
                gr.Markdown("**Screen watching** (keeps a private log of what you do, see README)")
                watch_radio = gr.Radio(["Off", "On", "Paused"], value=_WATCH_LABEL[watch_status()], show_label=False)
                watch_status_md = gr.Markdown("")

        with gr.Tab("Voice"):
            gr.Markdown(
                f"{NAME} already picked the most natural voice your computer has. "
                "Prefer a different one? Choose it here -- it's used from then on."
            )
            gr.HTML('<select id="voice_select" style="width:100%;padding:8px;'
                    'border-radius:8px;border:1px solid var(--border-color-primary,#ccc);"></select>')

        with gr.Tab("Remember / profile"):
            fact_in = gr.Textbox(label="Remember something", placeholder="e.g. My exam is on 3 November")
            remember_btn = gr.Button("Remember this")
            gr.Markdown("---\n**Your profile** -- what " + NAME + " knows about you on every message.")
            profile_box = gr.Textbox(value=load_profile, lines=16, show_label=False)
            gr.Button("Save profile").click(save_profile, profile_box, None)
            notes_in = gr.File(file_count="multiple", file_types=[".md", ".txt"],
                               label="Add notes (.md/.txt) for it to learn from")
            notes_in.upload(add_notes, notes_in, notes_in)
            gr.Markdown("---\n**Memory** -- every conversation is saved automatically. "
                        "Today's talk joins memory next time the app starts, or press this:")
            reindex_btn = gr.Button("Reindex memory now")
            reindex_status = gr.Markdown("")
            reindex_btn.click(lambda: f"Indexed {memory.build()} pieces, including today's conversation.",
                              None, reindex_status)

    box.submit(send, [box, chatbot], [box, chatbot])
    send_btn.click(send, [box, chatbot], [box, chatbot])
    clear_btn.click(lambda: [], None, chatbot)
    mic.stop_recording(voice_send, [mic, chatbot], [mic, chatbot])
    chatbot.change(None, [chatbot, speak_on], None, js=SPEAK_JS)
    explain_btn.click(explain_it, [file_in, link_in, q_in, chatbot], [chatbot, file_in, link_in, q_in])
    recap_btn.click(recap, chatbot, chatbot)
    watch_radio.change(set_watch, watch_radio, watch_status_md)
    remember_btn.click(remember, fact_in, fact_in)
    fact_in.submit(remember, fact_in, fact_in)

    demo.load(None, None, None, js=WAKE_JS)
    demo.load(None, None, None, js=VOICE_JS)

if __name__ == "__main__":
    if ON_SPACES:
        demo.launch(css=".hidden-io {display: none !important;}")
    else:
        demo.launch(server_name="127.0.0.1", inbrowser=True, css=".hidden-io {display: none !important;}")
