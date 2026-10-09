"""Chat with your personal assistant in the terminal.

Commands:  /remember <fact>   save a new fact about you
           /reindex           re-read me/ after editing files
           /reset             clear the conversation
           /quit
"""
from .config import load_config
from .memory import Memory
from .model import generate, load_model

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
