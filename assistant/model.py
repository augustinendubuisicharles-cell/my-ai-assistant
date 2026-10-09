"""Loads the local open model and generates replies.

Engines (`engine:` in config.yaml, default `auto`):
- transformers: Hugging Face models. With an NVIDIA GPU it loads `model_id` (4-bit);
  without one it loads the smaller `cpu_model_id` straight into RAM. Needs no extra
  install, and is what LoRA fine-tuning (training/) plugs into.
- llama_cpp: optional faster CPU engine (GGUF). Needs `pip install llama-cpp-python`
  (it can fail to build on Windows). `auto` uses it when it's installed and there's no GPU.
"""
import re


def _strip_think(text: str) -> str:
    """Remove any <think>...</think> block some models emit before their answer."""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()


def _use_llama_cpp(cfg: dict) -> bool:
    engine = cfg.get("engine", "auto")
    if engine != "auto":
        return engine == "llama_cpp"
    try:  # auto: the fast CPU engine if it's installed and there's no NVIDIA GPU
        import torch

        if torch.cuda.is_available():
            return False
        import llama_cpp  # noqa: F401

        return True
    except ImportError:
        return False


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

    gpu = torch.cuda.is_available()
    if gpu:
        src = str(cfg["model_dir"]) if cfg["model_dir"].exists() else cfg["model_id"]
    else:  # no NVIDIA GPU: use the small model so it fits in RAM and stays quick
        src = cfg.get("cpu_model_id", cfg["model_id"])
    tok = AutoTokenizer.from_pretrained(src)
    kwargs = {"torch_dtype": torch.bfloat16 if not gpu else "auto"}
    if gpu:
        kwargs["device_map"] = "auto"
        if cfg.get("load_in_4bit"):
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
