"""Loads the local open model and generates replies.

Two engines:
- llama_cpp: fast on a normal CPU, small quantized download (GGUF). Default when
  you have no NVIDIA GPU, so the assistant runs on a regular laptop/desktop.
- transformers: the full Hugging Face model, optional 4-bit on an NVIDIA GPU, and
  what LoRA fine-tuning (training/) plugs into.

Pick one with `engine:` in config.yaml, or leave it on `auto`.
"""
import re


def _strip_think(text: str) -> str:
    """Remove any <think>...</think> block some models emit before their answer."""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()


def _use_llama_cpp(cfg: dict) -> bool:
    engine = cfg.get("engine", "auto")
    if engine in ("llama_cpp", "transformers"):
        return engine == "llama_cpp"
    try:  # auto: use the fast CPU engine unless an NVIDIA GPU is available
        import torch

        return not torch.cuda.is_available()
    except Exception:
        return True


def load_model(cfg: dict):
    """Return (tok, model). For the llama.cpp engine tok is None."""
    if _use_llama_cpp(cfg):
        from llama_cpp import Llama

        g = cfg["gguf"]
        llm = Llama.from_pretrained(
            repo_id=g["repo"], filename=g["file"],
            n_ctx=g.get("context", 8192), verbose=False,
        )
        return None, llm

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    src = str(cfg["model_dir"]) if cfg["model_dir"].exists() else cfg["model_id"]
    tok = AutoTokenizer.from_pretrained(src)
    kwargs = {"torch_dtype": "auto"}
    if torch.cuda.is_available():
        kwargs["device_map"] = "auto"
        if cfg.get("load_in_4bit"):
            from transformers import BitsAndBytesConfig

            kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.bfloat16,
            )
    else:  # CPU: load straight into RAM rather than spilling to disk
        kwargs["low_cpu_mem_usage"] = True
    model = AutoModelForCausalLM.from_pretrained(src, **kwargs)
    if cfg.get("adapter_dir"):
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, cfg["adapter_dir"])
    model.eval()
    return tok, model


def generate(tok, model, messages: list[dict], cfg: dict) -> str:
    if tok is None:  # llama.cpp engine
        out = model.create_chat_completion(
            messages=messages,
            max_tokens=cfg["max_new_tokens"],
            temperature=cfg["temperature"],
        )
        return _strip_think(out["choices"][0]["message"]["content"])

    import torch

    kw = {"add_generation_prompt": True, "return_tensors": "pt", "return_dict": True}
    try:  # Qwen3: skip the long "thinking" block for snappy chat replies
        inputs = tok.apply_chat_template(messages, enable_thinking=False, **kw)
    except TypeError:  # other models don't take enable_thinking
        inputs = tok.apply_chat_template(messages, **kw)
    inputs = inputs.to(model.device)
    with torch.no_grad():
        out = model.generate(
            **inputs,
            max_new_tokens=cfg["max_new_tokens"],
            do_sample=cfg["temperature"] > 0,
            temperature=cfg["temperature"],
            pad_token_id=tok.eos_token_id,
        )
    prompt_len = inputs["input_ids"].shape[1]
    return _strip_think(tok.decode(out[0, prompt_len:], skip_special_tokens=True))
