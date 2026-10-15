"""AI matching: Claude reads each member's CV (or just their titles and level) and the day's best
candidate jobs, scores how well each fits, and says why in a few words.

Runs only when ANTHROPIC_API_KEY is set. Any error leaves the normal ranking as it was."""
import json
import os

MODEL = "claude-haiku-5-5"
TOP = 25          # how many of the best-scored jobs Claude looks at
POOR_FIT = 3      # fit below this goes to the back of the queue
DESC_CHARS = 700
CV_CHARS = 6000

SCHEMA = {
    "type": "object",
    "properties": {"jobs": {"type": "array", "items": {
        "type": "object",
        "properties": {"n": {"type": "integer"}, "fit": {"type": "integer"}, "why": {"type": "string"}},
        "required": ["n", "fit", "why"], "additionalProperties": False}}},
    "required": ["jobs"], "additionalProperties": False,
}

_client = None


def enabled() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _anthropic():
    global _client
    if _client is None:
        import anthropic
        _client = anthropic.Anthropic()
    return _client


def _prompt(jobs: list[dict], keywords: list[str], level: str, country: str, cv: str) -> str:
    person = (f"Job titles they want: {', '.join(keywords)}\nLevel: {level or 'any'}\nThey live in: {country or 'not given'}\n"
              + (f"Their CV:\n<cv>\n{cv[:CV_CHARS]}\n</cv>\n" if cv else "They haven't added a CV, so judge on titles and level.\n"))
    listing = "\n\n".join(f"[{i}] {j['title']} at {j['company'] or 'unknown company'} ({j['location'] or 'remote'})\n"
                          f"{(j.get('desc') or '')[:DESC_CHARS]}" for i, j in enumerate(jobs))
    return (f"You help a job seeker decide which jobs are worth applying to.\n\n{person}\n"
            f"Score every job below from 0 to 10 for how well this person fits it and could realistically get it "
            f"(10 = strong fit, 5 = possible, 0 = wrong field or far too senior). For each, give `why`: at most 8 plain "
            f"words a person reads in their email, naming the specific overlap (e.g. \"uses your Zendesk and refunds "
            f"experience\") or the gap. No full stops.\n\n<jobs>\n{listing}\n</jobs>")


def rerank(jobs: list[dict], keywords: list[str], level: str, country: str, cv: str = "") -> list[dict]:
    """The first TOP jobs reordered by Claude's fit score (poor fits moved to the back), each with a
    `fit` score and its reason first in `matched`. The rest keep their order after them."""
    head, rest = jobs[:TOP], jobs[TOP:]
    if not enabled() or not head:
        return jobs
    try:
        response = _anthropic().messages.create(
            model=MODEL, max_tokens=4000,
            messages=[{"role": "user", "content": _prompt(head, keywords, level, country, (cv or "").strip())}],
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        )
        text = next(b.text for b in response.content if b.type == "text")
        scores = {s["n"]: s for s in json.loads(text)["jobs"] if isinstance(s.get("n"), int)}
    except Exception as e:
        print(f"  AI matching skipped: {e}")
        return jobs
    for i, j in enumerate(head):
        s = scores.get(i)
        j["fit"] = max(0, min(10, int(s["fit"]))) if s else 5
        why = (s or {}).get("why", "").strip().rstrip(".")
        if why and j["fit"] >= POOR_FIT:
            j["matched"] = [why[:80]] + j["matched"]
    good = sorted((j for j in head if j["fit"] >= POOR_FIT), key=lambda j: -j["fit"])
    poor = [j for j in head if j["fit"] < POOR_FIT]
    print(f"  AI matching: {len(good)} good fit(s), {len(poor)} poor of {len(head)} checked")
    return good + rest + poor
