"""Reads documents and web pages into plain text so the assistant can explain them.
Supports: .pdf, .docx, .txt/.md/.csv/code files, and http(s) URLs."""
import re
from pathlib import Path

MAX_CHARS = 60_000  # ~15k tokens; longer texts are summarized piece by piece


def read_source(src: str) -> tuple[str, str]:
    """Return (title, text) for a file path or URL."""
    if re.match(r"https?://", src):
        return _read_url(src)
    path = Path(src).expanduser()
    if not path.exists():
        raise FileNotFoundError(f"No such file: {path}")
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError

        try:
            reader = PdfReader(path)
        except PdfReadError as e:
            raise ValueError(f"That PDF looks damaged or isn't a real PDF ({e}).") from e
        if reader.is_encrypted:
            try:
                reader.decrypt("")  # some PDFs are "encrypted" with no real password
            except Exception:
                pass
        if reader.is_encrypted:
            raise ValueError("That PDF is password-protected -- remove the password first.")
        text = "\n\n".join(page.extract_text() or "" for page in reader.pages)
    elif suffix == ".docx":
        import docx

        text = "\n".join(p.text for p in docx.Document(path).paragraphs)
    else:
        text = path.read_text(encoding="utf-8", errors="replace")
    return path.name, text.strip()


def _read_url(url: str) -> tuple[str, str]:
    import requests
    from bs4 import BeautifulSoup

    resp = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0 my-ai-assistant"})
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form"]):
        tag.decompose()
    title = soup.title.get_text(strip=True) if soup.title else url
    main = soup.find("article") or soup.find("main") or soup.body or soup
    text = re.sub(r"\n{3,}", "\n\n", main.get_text("\n", strip=True))
    return title, text


def split_text(text: str, size: int = MAX_CHARS) -> list[str]:
    return [text[i : i + size] for i in range(0, len(text), size)] or [""]
