"""Personal memory: chunks your profile and notes, embeds them, and retrieves
the most relevant pieces for each question (retrieval-augmented generation)."""
import json
from datetime import date
from pathlib import Path

import numpy as np

CHUNK_CHARS = 600


def _chunks(text: str, source: str) -> list[dict]:
    """Split on blank lines / headings, then pack paragraphs into ~CHUNK_CHARS pieces."""
    paras = [p.strip() for p in text.split("\n\n") if p.strip()]
    out, buf = [], ""
    for p in paras:
        if buf and len(buf) + len(p) > CHUNK_CHARS:
            out.append(buf)
            buf = ""
        buf = f"{buf}\n\n{p}" if buf else p
    if buf:
        out.append(buf)
    return [{"source": source, "text": c} for c in out]


class Memory:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.index_dir: Path = cfg["index_dir"]
        self._embedder = None
        self.chunks: list[dict] = []
        self.vectors = np.zeros((0, 0), dtype=np.float32)

    @property
    def embedder(self):
        if self._embedder is None:
            from sentence_transformers import SentenceTransformer

            self._embedder = SentenceTransformer(self.cfg["embedding_model"])
        return self._embedder

    def _sources(self) -> list[Path]:
        files = []
        if self.cfg["profile_file"].exists():
            files.append(self.cfg["profile_file"])
        notes = self.cfg["notes_dir"]
        if notes.exists():
            files += sorted(p for p in notes.rglob("*") if p.suffix in {".md", ".txt"})
        return files

    def build(self) -> int:
        root = self.cfg["profile_file"].parent.parent
        self.chunks = []
        for f in self._sources():
            self.chunks += _chunks(f.read_text(encoding="utf-8"), str(f.relative_to(root)))
        texts = [c["text"] for c in self.chunks] or [""]
        self.vectors = self.embedder.encode(texts, normalize_embeddings=True).astype(np.float32)
        self.index_dir.mkdir(parents=True, exist_ok=True)
        np.save(self.index_dir / "vectors.npy", self.vectors)
        (self.index_dir / "chunks.json").write_text(json.dumps(self.chunks, indent=1))
        return len(self.chunks)

    def load(self) -> None:
        if not (self.index_dir / "chunks.json").exists():
            self.build()
            return
        self.chunks = json.loads((self.index_dir / "chunks.json").read_text())
        self.vectors = np.load(self.index_dir / "vectors.npy")

    def search(self, query: str, k: int | None = None) -> list[dict]:
        if not self.chunks:
            return []
        q = self.embedder.encode([query], normalize_embeddings=True)[0]
        scores = self.vectors @ q
        best = np.argsort(-scores)[: k or self.cfg["top_k"]]
        return [{**self.chunks[i], "score": float(scores[i])} for i in best]

    def remember(self, fact: str) -> None:
        """Append a new fact to today's note and rebuild the index."""
        notes = self.cfg["notes_dir"]
        notes.mkdir(parents=True, exist_ok=True)
        with open(notes / "remembered.md", "a", encoding="utf-8") as f:
            f.write(f"\n\n- ({date.today().isoformat()}) {fact.strip()}")
        self.build()
