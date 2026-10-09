# My AI Assistant

A private, personal AI assistant that runs on an open-source model and learns about you.

- **Brain:** [Qwen3-8B](https://huggingface.co/Qwen/Qwen3-8B), a top open-weight model (Apache 2.0) that fits on consumer hardware. Swap it in `config.yaml`.
- **Memory (RAG):** everything in `me/` (your profile and notes) is indexed and the most relevant facts are fed to the model on every message. Update a file and it knows instantly, no retraining.
- **Training (optional):** a LoRA fine-tuning script that teaches it your style and personality from example conversations.

> Keep this repository **private**: `me/` holds personal information.
> The model weights (several GB) are downloaded locally into `models/` and never committed.

## 1. Install

```bash
git clone https://github.com/<you>/my-ai-assistant && cd my-ai-assistant
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## 2. Download the model

```bash
python scripts/download_model.py                  # Qwen3-8B (~16 GB)
python scripts/download_model.py Qwen/Qwen3-4B    # lighter (~8 GB), set model_id in config.yaml too
```

| Your hardware | Recommended model | config |
|---|---|---|
| NVIDIA GPU 12GB+ | Qwen/Qwen3-8B | `load_in_4bit: true` |
| NVIDIA GPU 6-8GB | Qwen/Qwen3-4B | `load_in_4bit: true` |
| Mac (M1-M4, 16GB+) / CPU only | Qwen/Qwen3-4B | `load_in_4bit: false` (slower) |

## 3. Tell it about yourself

1. Fill in `me/profile.md`.
2. Add any notes, journals or project docs to `me/notes/`.
3. `python scripts/build_memory.py`

## 4. Chat

**The app (recommended):**

```bash
python app.py
```

It opens in your web browser (only on your computer, at http://127.0.0.1:7860) with:
- a chat window
- **Explain something:** drop in a PDF / Word file or paste a link, then press *Explain it*
- **My day:** *Recap my day*, plus Start / Pause / Resume / Stop for screen watching
- **Remember:** type a fact and save it
- **Voice:** press the mic, speak, press stop; it answers in text and out loud (turn off with *Read replies out loud*). Speech recognition runs locally with Whisper, so your voice never leaves your computer.
- an **About me** tab to edit your profile and drop in notes

**Or in the terminal:** `python -m assistant.chat`

Terminal commands:

| Command | What it does |
|---|---|
| `/read report.pdf` | Reads a PDF, Word doc (.docx), text/code file or web page and explains it simply |
| `/read https://example.com/article what does this mean for my trading?` | Add a question after the file or link to ask something specific |
| `/today` | Recap of what you did on your computer today (needs screen watching, below) |
| `/remember I prefer short answers` | Saves a new fact about you |
| `/reindex` | Re-reads `me/` after you edit files |
| `/reset`, `/quit` | Clear the conversation, exit |

After `/read`, keep asking follow-up questions about the document in normal chat.
Scanned PDFs (photos of pages) have no text to read, so they won't work yet.

## 5. Screen watching (optional)

Let the assistant see what you do each day so it can recap your day, notice where your time goes, and answer things like "what was that site I was on this morning?".

```bash
python -m assistant.watch          # leave running in its own terminal; Ctrl+C to stop
python -m assistant.watch pause    # pause any time (e.g. private stuff), then: resume
```

- **titles mode (default):** logs which app and window you're on and for how long, e.g. `- 14:05 [chrome] TradingView BTCUSD (25 min)`. Very light, works on any PC.
- **vision mode:** set `watch.mode: vision` in `config.yaml`. Every 5 minutes it also looks at a screenshot with a local vision model (Qwen3-VL-4B) and writes one sentence about what you're doing. Needs an NVIDIA GPU with ~10GB free.

Privacy: everything stays on your computer. Screenshots are never saved, only the text log in `me/notes/activity/`, which is also kept out of git. Password managers, banking and private-browsing windows are skipped; add your own words to `watch.ignore`.
On macOS, allow your terminal under System Settings > Privacy & Security > Accessibility and Screen Recording.

## 6. Training (fine-tuning)

Memory already makes the assistant *know* you. Fine-tuning changes *how it talks*: your tone, format and habits.

1. Write example conversations in `training/examples.jsonl` (one JSON per line, the reply exactly as you'd want it). 100+ examples give a noticeable effect.
2. `python training/make_dataset.py` (adds Q&A pairs from your profile)
3. `python training/finetune_lora.py`
4. Set `adapter_dir: outputs/lora-adapter` in `config.yaml` and chat again.

### Training: where to get a GPU

Real fine-tuning needs an NVIDIA GPU. Options, cheapest first:

- **Google Colab (free T4, 16GB):** enough for Qwen3-4B. Upload the repo, `pip install -r requirements.txt`, run the two training scripts, download `outputs/lora-adapter`.
- **Colab Pro / Kaggle (free P100/T4 x2):** more hours per week.
- **Rented GPU (RunPod, Vast.ai, Lambda):** an A10/L4/A100 for roughly $0.30-$1.50 per hour; a training run on a few hundred examples takes well under an hour for the 8B model.
- **Your own PC** with an RTX 3090/4090 (24GB).

## Layout

```
config.yaml              model + memory settings
assistant/               chat app, memory (RAG), model loading
scripts/                 download_model.py, build_memory.py
me/profile.md            who you are (edit this!)
me/notes/                anything else it should know
training/                dataset builder + LoRA fine-tuning
```
