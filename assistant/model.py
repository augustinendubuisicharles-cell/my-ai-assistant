"""Loads the local open model (plus an optional LoRA adapter) and generates replies."""
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer


def load_model(cfg: dict):
    src = cfg["model_dir"] if cfg["model_dir"].exists() else cfg["model_id"]
    tok = AutoTokenizer.from_pretrained(src)
    kwargs = {"device_map": "auto", "torch_dtype": "auto"}
    if cfg.get("load_in_4bit") and torch.cuda.is_available():
        from transformers import BitsAndBytesConfig

        kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
        )
    model = AutoModelForCausalLM.from_pretrained(src, **kwargs)
    if cfg.get("adapter_dir"):
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, cfg["adapter_dir"])
    model.eval()
    return tok, model


def generate(tok, model, messages: list[dict], cfg: dict) -> str:
    template_kwargs = {"add_generation_prompt": True, "return_tensors": "pt"}
    try:  # Qwen3: skip the long "thinking" block for snappy chat replies
        inputs = tok.apply_chat_template(messages, enable_thinking=False, **template_kwargs)
    except TypeError:
        inputs = tok.apply_chat_template(messages, **template_kwargs)
    inputs = inputs.to(model.device)
    with torch.no_grad():
        out = model.generate(
            inputs,
            max_new_tokens=cfg["max_new_tokens"],
            do_sample=cfg["temperature"] > 0,
            temperature=cfg["temperature"],
            pad_token_id=tok.eos_token_id,
        )
    return tok.decode(out[0, inputs.shape[1]:], skip_special_tokens=True).strip()
