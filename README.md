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

## 2. The model

The app picks the right model for your computer automatically (`config.yaml`):

| Your hardware | What runs | Setup |
|---|---|---|
| **No NVIDIA GPU** (most laptops/desktops) | `cpu_model_id`: Qwen2.5-3B-Instruct (~6 GB) | Nothing, it downloads on first run |
| **NVIDIA GPU** | `model_id`: Qwen3-8B, 4-bit | `python scripts/download_model.py` (~16 GB) |

Slow or low on RAM? Set `cpu_model_id: Qwen/Qwen3-1.7B` (~3.5 GB). Want smarter answers and have 16 GB+ RAM? Try `Qwen/Qwen3-4B`.

## 3. Tell it about yourself

1. Fill in `me/profile.md`.
2. Add any notes, journals or project docs to `me/notes/`.
3. `python scripts/build_memory.py`

## 4. Chat

```bash
python app.py
```

It opens in your browser (only on your computer, at http://127.0.0.1:7860). By default it's
always listening: just say **"Signal, ..."** followed by what you want, hands-free, and it
answers out loud. (In Chrome/Edge this sends your speech to the browser's own speech-to-text
service to turn it into text -- it never leaves your computer otherwise. Turn off "Listening"
in the app if you'd rather not, and use the mic or keyboard in "More" instead.)

Two switches at the top: **Listening** (always-on mic) and **Speaks** (reads replies aloud).
It automatically picks the most natural voice your computer already has; to use a different one,
go to **More -> Voice**. (Real voice cloning -- speaking in your actual voice -- needs a heavier
model and a GPU to run fast; ask if you want to try it.)

Everything else -- typing, push-to-talk, explaining files/links, your day's recap, screen
watching, remembering facts, your profile -- is tucked under **More** so the main screen stays
just you and it talking.

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
