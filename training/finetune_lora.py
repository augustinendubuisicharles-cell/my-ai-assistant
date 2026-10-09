"""QLoRA fine-tuning: trains a small adapter (~100MB) on top of the base model.
Needs an NVIDIA GPU with ~16GB+ VRAM for an 8B model (or ~10GB for a 4B model).
Runs fine on a free Google Colab T4 for the 4B model, or a rented A10/A100/L4.

    python training/make_dataset.py
    python training/finetune_lora.py
    # then set adapter_dir: outputs/lora-adapter in config.yaml
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import torch
from datasets import load_dataset
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from trl import SFTConfig, SFTTrainer

from assistant.config import ROOT, load_config

cfg = load_config()
src = str(cfg["model_dir"]) if cfg["model_dir"].exists() else cfg["model_id"]
out_dir = ROOT / "outputs/lora-adapter"

if not torch.cuda.is_available():
    sys.exit("No NVIDIA GPU found. See README section 'Training: where to get a GPU'.")

tok = AutoTokenizer.from_pretrained(src)
model = AutoModelForCausalLM.from_pretrained(
    src,
    device_map="auto",
    quantization_config=BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16,
    ),
)

dataset = load_dataset("json", data_files=str(ROOT / "training/dataset.jsonl"), split="train")

trainer = SFTTrainer(
    model=model,
    processing_class=tok,
    train_dataset=dataset,
    peft_config=LoraConfig(
        r=16,
        lora_alpha=32,
        lora_dropout=0.05,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        task_type="CAUSAL_LM",
    ),
    args=SFTConfig(
        output_dir=str(ROOT / "outputs/checkpoints"),
        num_train_epochs=3,
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        learning_rate=2e-4,
        logging_steps=5,
        save_strategy="epoch",
        bf16=torch.cuda.is_bf16_supported(),
        fp16=not torch.cuda.is_bf16_supported(),
        max_length=2048,
        report_to="none",
    ),
)
trainer.train()
trainer.save_model(str(out_dir))
tok.save_pretrained(str(out_dir))
print(f"Adapter saved to {out_dir}. Set adapter_dir: outputs/lora-adapter in config.yaml")
