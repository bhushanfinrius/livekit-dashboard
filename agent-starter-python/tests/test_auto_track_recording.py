import asyncio
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import agent  # noqa: E402
from agent import (  # noqa: E402
    _mixed_egress_filepath,
    _pick_primary_recording_url,
    _publisher_identity_from_object_path,
    _recording_role_for_object_path,
    build_room_egress,
    campaign_room_allowed_from_list,
    ensure_room_recording,
)

FAKE_CREDS = '{"type":"service_account"}'


def test_publisher_identity_from_object_path() -> None:
    path = "recordings/mahindra_scraping/room1/test_918177938974-20260902101520.ogg"
    assert _publisher_identity_from_object_path(path) == "test_918177938974"


def test_publisher_identity_strips_iso_time_and_track_sid() -> None:
    """Real LiveKit output: {identity}-{iso time}-{track sid}.ogg"""
    path = "recordings/a/room1/agent-verify-2026-09-02T120631-TR_ADqxsRMGeQsyx.ogg"
    assert _publisher_identity_from_object_path(path) == "agent-verify"


def test_publisher_identity_keeps_bare_phone_number() -> None:
    path = "recordings/a/room1/918177938974-1750000000.ogg"
    assert _publisher_identity_from_object_path(path) == "918177938974"


def test_recording_role_agent_with_iso_time_and_track_sid() -> None:
    path = "recordings/a/room1/agent-verify-2026-09-02T120631-TR_ADqxsRMGeQsyx.ogg"
    assert _recording_role_for_object_path(path) == "agent"


def test_recording_role_sip_with_iso_time_and_track_sid() -> None:
    path = "recordings/a/room1/sip_918177938974-2026-09-02T120630-TR_AFvEAZ5dqrsuS.ogg"
    assert _recording_role_for_object_path(path) == "prospect"


def test_recording_role_prospect() -> None:
    path = "recordings/mahindra_scraping/room1/test_918177938974-20260902101520.ogg"
    assert _recording_role_for_object_path(path) == "prospect"


def test_recording_role_sip_identity() -> None:
    path = "recordings/mahindra_scraping/room1/sip_918177938974-20260902101520.ogg"
    assert _recording_role_for_object_path(path) == "prospect"


def test_recording_role_agent() -> None:
    path = "recordings/mahindra_scraping/room1/agent-AJ_abc123-20260902101520.ogg"
    assert _recording_role_for_object_path(path) == "agent"


def test_recording_role_mixed() -> None:
    path = "recordings/mahindra_scraping/room1/room1-mixed.ogg"
    assert _recording_role_for_object_path(path) == "mixed"


def test_recording_role_deck_console_is_prospect() -> None:
    """The browser participant in Talk stands in for the prospect side."""
    path = "recordings/mahindra_scraping/room1/deck-console-abc123-20260902101520.ogg"
    assert _recording_role_for_object_path(path) == "prospect"


def test_pick_primary_prefers_mixed() -> None:
    recordings = [
        {"role": "agent", "url": "https://example.com/agent.ogg"},
        {"role": "prospect", "url": "https://example.com/prospect.ogg"},
        {"role": "mixed", "url": "https://example.com/mixed.ogg"},
    ]
    assert _pick_primary_recording_url(recordings) == "https://example.com/mixed.ogg"


def test_pick_primary_prefers_prospect_without_mixed() -> None:
    recordings = [
        {"role": "agent", "url": "https://example.com/agent.ogg"},
        {"role": "prospect", "url": "https://example.com/prospect.ogg"},
    ]
    assert _pick_primary_recording_url(recordings) == "https://example.com/prospect.ogg"


def test_pick_primary_falls_back_to_agent() -> None:
    recordings = [{"role": "agent", "url": "https://example.com/agent.ogg"}]
    assert _pick_primary_recording_url(recordings) == "https://example.com/agent.ogg"


def test_build_room_egress_has_mixed_and_tracks() -> None:
    egress = build_room_egress(FAKE_CREDS)
    assert egress.HasField("room")
    assert egress.HasField("tracks")
    assert egress.room.audio_only is True
    # layout / custom_base_url force the Chrome video pipeline, which fails on SIP rooms.
    assert egress.room.layout == ""
    assert egress.room.custom_base_url == ""
    assert egress.room.file_outputs[0].filepath.endswith("-mixed.ogg")
    assert "{publisher_identity}" in egress.tracks.filepath


def test_build_room_egress_campaign_tracks_only() -> None:
    egress = build_room_egress(FAKE_CREDS, "camp-17400407-bb225e9e-aa88d4981169")
    assert not egress.HasField("room")
    assert egress.HasField("tracks")


def test_campaign_room_allowed_keeps_oldest_three() -> None:
    class _Room:
        def __init__(self, name: str, creation_time: int) -> None:
            self.name = name
            self.creation_time = creation_time
            self.creation_time_ms = 0

    rooms = [
        _Room("camp-lead-a-1", 1),
        _Room("camp-lead-a-2", 2),
        _Room("camp-lead-b-1", 3),
        _Room("camp-lead-b-2", 4),
        _Room("camp-lead-c-1", 5),
    ]
    assert campaign_room_allowed_from_list("camp-lead-a-1", rooms, cap=3) is True
    assert campaign_room_allowed_from_list("camp-lead-b-1", rooms, cap=3) is True
    assert campaign_room_allowed_from_list("camp-lead-b-2", rooms, cap=3) is False
    assert campaign_room_allowed_from_list("camp-new-lead", rooms, cap=3) is False
    assert campaign_room_allowed_from_list("deck-console-abc", rooms, cap=3) is True


def test_mixed_filepath_is_templated_without_room() -> None:
    assert "{room_name}" in _mixed_egress_filepath()
    assert _mixed_egress_filepath("room1").endswith("/room1/room1-mixed.ogg")


class _FakeRoomService:
    def __init__(self) -> None:
        self.requests = []

    async def create_room(self, request):
        self.requests.append(request)


class _FakeApi:
    def __init__(self, room_service) -> None:
        self.room = room_service

    async def aclose(self) -> None:
        return None


@pytest.fixture
def patched_livekit(monkeypatch):
    room_service = _FakeRoomService()
    monkeypatch.setattr(agent.api, "LiveKitAPI", lambda *a, **k: _FakeApi(room_service))
    monkeypatch.setattr(agent, "_load_gcs_creds_json", lambda room_name: FAKE_CREDS)
    return room_service


def test_ensure_room_recording_campaign_skips_mixed(
    monkeypatch, patched_livekit
) -> None:
    monkeypatch.setattr(agent, "_list_room_egress", _async_return(["job-1"]))
    asyncio.run(ensure_room_recording("camp-lead-1"))
    egress = patched_livekit.requests[0].egress
    assert not egress.HasField("room")
    assert egress.HasField("tracks")


def test_ensure_room_recording_skips_fallback_when_egress_attached(
    monkeypatch, patched_livekit
) -> None:
    monkeypatch.setattr(agent, "_list_room_egress", _async_return(["job-1"]))
    active, needs_fallback = asyncio.run(ensure_room_recording("room1"))
    assert active is True
    assert needs_fallback is False
    assert patched_livekit.requests[0].name == "room1"


def test_ensure_room_recording_requests_fallback_when_room_pre_existed(
    monkeypatch, patched_livekit
) -> None:
    """CreateRoom silently ignores egress config on an existing room."""
    monkeypatch.setattr(agent, "_list_room_egress", _async_return([]))
    active, needs_fallback = asyncio.run(ensure_room_recording("room1"))
    assert active is True
    assert needs_fallback is True


def test_ensure_room_recording_disabled_by_config(monkeypatch, patched_livekit) -> None:
    monkeypatch.setattr(agent, "ROOM_COMPOSITE_EGRESS_ENABLED", False)
    monkeypatch.setattr(agent, "AUTO_TRACK_EGRESS_ENABLED", False)
    assert asyncio.run(ensure_room_recording("room1")) == (False, False)
    assert patched_livekit.requests == []


def test_ensure_room_recording_without_credentials(
    monkeypatch, patched_livekit
) -> None:
    monkeypatch.setattr(agent, "_load_gcs_creds_json", lambda room_name: None)
    assert asyncio.run(ensure_room_recording("room1")) == (False, False)


def _async_return(value):
    async def _inner(*_args, **_kwargs):
        return value

    return _inner


def test_egress_unavailable_detects_livekit_503() -> None:
    err = Exception(
        "ServerError(code=unavailable, message=twirp error unknown: "
        "no response from servers, status=503)"
    )
    assert agent._egress_unavailable(err) is True
    assert agent._egress_unavailable(Exception("duplicate egress")) is False


@pytest.mark.asyncio
async def test_start_mixed_egress_trips_circuit_on_503(monkeypatch, tmp_path) -> None:
    circuit = tmp_path / "egress-circuit"
    monkeypatch.setattr(agent, "EGRESS_CIRCUIT_PATH", str(circuit))
    monkeypatch.setattr(agent, "EGRESS_CIRCUIT_SECONDS", 90)
    monkeypatch.setattr(agent, "_mixed_egress_gate", asyncio.Semaphore(1))

    class _Egress:
        calls = 0

        async def start_room_composite_egress(self, _request):
            self.calls += 1
            raise RuntimeError(
                "twirp error unknown: no response from servers, status=503"
            )

    shared = _Egress()

    class _Api:
        def __init__(self):
            self.egress = shared

        async def aclose(self):
            return None

    monkeypatch.setattr(agent.api, "LiveKitAPI", lambda *_a, **_k: _Api())
    first = await agent.start_mixed_egress("camp-room", FAKE_CREDS)
    second = await agent.start_mixed_egress("camp-room-2", FAKE_CREDS)
    assert first is None
    assert second is None
    assert shared.calls == 1
    assert agent._egress_circuit_open() is True
