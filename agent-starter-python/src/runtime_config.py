"""Read livekit.local.toml, then overlay env from Deck (Agents → Deploy)."""

from __future__ import annotations

import os
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10
    tomllib = None  # type: ignore[assignment]


def _load_toml() -> dict:
    path = Path(__file__).resolve().parent.parent / "livekit.local.toml"
    if tomllib is None or not path.is_file():
        return {}
    with path.open("rb") as handle:
        return tomllib.load(handle)


_CFG = _load_toml()
_AGENT = _CFG.get("agent") if isinstance(_CFG.get("agent"), dict) else {}
_MODELS = _CFG.get("models") if isinstance(_CFG.get("models"), dict) else {}
_AUDIO = _CFG.get("audio") if isinstance(_CFG.get("audio"), dict) else {}

AGENT_NAME = (
    os.getenv("AGENT_NAME", "").strip()
    or str(_AGENT.get("name") or "CTF-Agent").strip()
    or "CTF-Agent"
)

MODEL_PROVIDER = (
    os.getenv("AGENT_MODEL_PROVIDER", "").strip().lower()
    or str(_MODELS.get("provider") or "google").strip().lower()
)

GOOGLE_LLM_MODEL = (
    os.getenv("GOOGLE_LLM_MODEL", "").strip()
    or str(_MODELS.get("llm") or "gemini-2.5-flash").strip()
)

USE_LIVEKIT_INFERENCE = MODEL_PROVIDER in {"livekit", "livekit-inference", "inference"}

_skip = os.getenv("SKIP_BVC", "").strip().lower()
if _skip:
    SKIP_NOISE_CANCELLATION = _skip in {"1", "true", "yes"}
else:
    SKIP_NOISE_CANCELLATION = not bool(_AUDIO.get("noise_cancellation", False))
