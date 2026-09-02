import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from agent import (  # noqa: E402
    _pick_primary_recording_url,
    _publisher_identity_from_object_path,
    _recording_role_for_object_path,
)


def test_publisher_identity_from_object_path() -> None:
    path = "recordings/mahindra_scraping/room1/test_918177938974-20260902101520.ogg"
    assert _publisher_identity_from_object_path(path) == "test_918177938974"


def test_recording_role_prospect() -> None:
    path = "recordings/mahindra_scraping/room1/test_918177938974-20260902101520.ogg"
    assert _recording_role_for_object_path(path) == "prospect"


def test_recording_role_agent() -> None:
    path = "recordings/mahindra_scraping/room1/agent-AJ_abc123-20260902101520.ogg"
    assert _recording_role_for_object_path(path) == "agent"


def test_pick_primary_prefers_prospect() -> None:
    recordings = [
        {"role": "agent", "url": "https://example.com/agent.ogg"},
        {"role": "prospect", "url": "https://example.com/prospect.ogg"},
    ]
    assert _pick_primary_recording_url(recordings) == "https://example.com/prospect.ogg"


def test_pick_primary_falls_back_to_agent() -> None:
    recordings = [{"role": "agent", "url": "https://example.com/agent.ogg"}]
    assert _pick_primary_recording_url(recordings) == "https://example.com/agent.ogg"
