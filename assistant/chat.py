"""Chat with your personal assistant in the terminal.

Commands:  /read <file or URL> [question]
                              read a PDF, Word doc, text file or web page and explain it
           /remember <fact>   save a new fact about you
           /reindex           re-read me/ after editing files
           /reset             clear the conversation
           /quit
"""
from .config import load_config
from .memory import Memory
from .model import generate, load_model
from .reader import read_source, split_text

SYSTEM = """You are {name}, the personal AI assistant of the user described below.
You know them well. Use the facts in YOUR MEMORY to personalize every answer:
their goals, preferences, schedule, projects and way of communicating.
If a fact is not in memory, say you don't know rather than inventing it.
Be direct, warm and practical.

ABOUT THE USER (profile):
{profile}

YOUR MEMORY (most relevant notes for this message):
{memories}
"""


def build_system(cfg: dict, memory: Memory, user_msg: str) -> str:
    profile_path = cfg["profile_file"]
    profile = profile_path.read_text(encoding="utf-8") if profile_path.exists() else "(empty)"
    hits = [h for h in memory.search(user_msg) if not h["source"].endswith(profile_path.name)]
    memories = "\n---\n".join(f"[{h['source']}] {h['text']}" for h in hits) or "(none)"
    return SYSTEM.format(name=cfg["assistant_name"], profile=profile[:6000], memories=memories)


def explain(cfg: dict, memory: Memory, tok, model, arg: str) -> tuple[str, str]:
    """Read a file/URL and explain it. Returns (what the user asked, the explanation)."""
    arg = arg.strip()
    if arg[:1] in "\"'":  # quoted path with spaces: /read "My Report.pdf" question
        src, _, question = arg[1:].partition(arg[0])
    else:
        src, _, question = arg.partition(" ")
    question = question.strip() or "Explain this to me in simple terms: what it says, the key points, and what matters for me."
    title, text = read_source(src)
    if not text:
        return question, "I couldn't find any readable text in that (it may be a scanned image)."
    parts = split_text(text)
    if len(parts) > 1:  # too long to read at once: take notes on each part first
        print(f"(long document: reading it in {len(parts)} parts)")
        notes = []
        for i, part in enumerate(parts, 1):
            notes.append(generate(tok, model, [{"role": "user", "content":
                f"Part {i} of {len(parts)} of '{title}'. Write detailed notes of the key facts, "
                f"numbers and arguments, keeping anything relevant to: {question}\n\n{part}"}], cfg))
        text = "\n\n".join(f"[Notes on part {i}]\n{n}" for i, n in enumerate(notes, 1))
    system = build_system(cfg, memory, question)
    user = f"Here is '{title}':\n\n<document>\n{text}\n</document>\n\n{question}"
    reply = generate(tok, model, [{"role": "system", "content": system}, {"role": "user", "content": user}], cfg)
    return f"[I shared '{title}' with you] {question}", reply


def main() -> None:
    cfg = load_config()
    memory = Memory(cfg)
    memory.load()
    print("Loading model (first run downloads it)...")
    tok, model = load_model(cfg)
    history: list[dict] = []
    print(f"{cfg['assistant_name']} is ready. Type /quit to exit.\n")
    while True:
        try:
            msg = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not msg:
            continue
        if msg == "/quit":
            break
        if msg == "/reset":
            history = []
            continue
        if msg == "/reindex":
            print(f"indexed {memory.build()} chunks")
            continue
        if msg.startswith("/read "):
            try:
                asked, reply = explain(cfg, memory, tok, model, msg[len("/read "):])
            except Exception as e:  # bad path, network error, unreadable file
                print(f"Couldn't read that: {e}")
                continue
            history += [{"role": "user", "content": asked}, {"role": "assistant", "content": reply}]
            print(f"\n{cfg['assistant_name']}> {reply}\n")
            continue
        if msg.startswith("/remember "):
            memory.remember(msg[len("/remember "):])
            print("saved to me/notes/remembered.md")
            continue
        messages = [{"role": "system", "content": build_system(cfg, memory, msg)}]
        messages += history[-12:] + [{"role": "user", "content": msg}]
        reply = generate(tok, model, messages, cfg)
        history += [{"role": "user", "content": msg}, {"role": "assistant", "content": reply}]
        print(f"\n{cfg['assistant_name']}> {reply}\n")


if __name__ == "__main__":
    main()
