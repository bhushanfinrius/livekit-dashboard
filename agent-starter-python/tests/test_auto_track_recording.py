import asyncio
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import agent  # noqa: E402
from agent import (  # noqa: E402
    _audio_track_targets,
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


def test_audio_track_targets_includes_agent_and_sip() -> None:
    class _Pub:
        def __init__(self, sid: str, kind: str) -> None:
            self.sid = sid
            self.kind = kind

    class _Participant:
        def __init__(self, identity: str, pubs: dict) -> None:
            self.identity = identity
            self.track_publications = pubs

    class _Room:
        local_participant = _Participant("CTF-Agent", {"a": _Pub("TR_AGENT", "KIND_AUDIO")})
        remote_participants = {
            "sip": _Participant("sip_918668641761", {"s": _Pub("TR_SIP", "KIND_AUDIO")}),
        }

    targets = _audio_track_targets(_Room())
    identities = {identity for _sid, identity in targets}
    sids = {sid for sid, _identity in targets}
    assert "CTF-Agent" in identities
    assert "sip_918668641761" in identities
    assert sids == {"TR_AGENT", "TR_SIP"}


def test_is_mixed_egress_detects_room_composite() -> None:
    class _Job:
        type = "EGRESS_TYPE_ROOM_COMPOSITE"

    assert agent._is_mixed_egress(_Job()) is True
    assert agent._is_mixed_egress("job-1") is False
    assert agent._is_mixed_egress(None) is False


def test_egress_already_started_detects_duplicate() -> None:
    assert agent._egress_already_started(Exception("egress already started")) is True
    assert agent._egress_already_started(Exception("duplicate egress")) is True
    assert agent._egress_already_started(Exception("status=503")) is False


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


class _CampRoom:
    def __init__(
        self,
        name: str,
        creation_time: int,
        num_participants: int = 1,
        creation_time_ms: int = 0,
        metadata: str = "",
    ) -> None:
        self.name = name
        self.creation_time = creation_time
        self.creation_time_ms = creation_time_ms
        self.num_participants = num_participants
        self.metadata = metadata


def test_campaign_allows_three_distinct_phone_numbers_at_once() -> None:
    rooms = [
        _CampRoom(
            "camp-1bff08c5-2af6ae71-aaaaaa111111",
            1,
            metadata='{"lead_id":"2af6ae71-aaa","contact_number":"+918668641761"}',
        ),
        _CampRoom(
            "camp-1bff08c5-b79e3590-bbbbbb222222",
            2,
            metadata='{"lead_id":"b79e3590-bbb","contact_number":"+919371099207"}',
        ),
        _CampRoom(
            "camp-1bff08c5-532390a8-cccccc333333",
            3,
            metadata='{"lead_id":"532390a8-ccc","contact_number":"+918177938974"}',
        ),
    ]
    assert (
        campaign_room_allowed_from_list("camp-1bff08c5-2af6ae71-aaaaaa111111", rooms)
        is True
    )
    assert (
        campaign_room_allowed_from_list("camp-1bff08c5-b79e3590-bbbbbb222222", rooms)
        is True
    )
    assert (
        campaign_room_allowed_from_list("camp-1bff08c5-532390a8-cccccc333333", rooms)
        is True
    )


def test_campaign_allows_three_distinct_leads_and_drops_same_lead_dupes() -> None:
    """Solvox opens 3 rooms per lead. Only extra rooms for the same lead are dropped."""
    rooms = [
        _CampRoom("camp-17400407-bb225e9e-aaaaaa111111", 1),
        _CampRoom("camp-17400407-bb225e9e-bbbbbb222222", 2),
        _CampRoom("camp-17400407-bb225e9e-cccccc333333", 3),
        _CampRoom("camp-17400407-0911723d-dddddd444444", 4),
        _CampRoom("camp-17400407-5b78f8f0-eeeeee555555", 5),
    ]
    assert (
        campaign_room_allowed_from_list("camp-17400407-bb225e9e-cccccc333333", rooms)
        is True
    )
    assert (
        campaign_room_allowed_from_list("camp-17400407-bb225e9e-aaaaaa111111", rooms)
        is False
    )
    assert (
        campaign_room_allowed_from_list("camp-17400407-0911723d-dddddd444444", rooms)
        is True
    )
    assert (
        campaign_room_allowed_from_list("camp-17400407-5b78f8f0-eeeeee555555", rooms)
        is True
    )
    assert campaign_room_allowed_from_list("deck-console-abc", rooms) is True


def test_campaign_allows_fourth_lead_so_leftovers_cannot_kill_new_calls() -> None:
    rooms = [
        _CampRoom("camp-17400407-11111111-aaaaaa111111", 1),
        _CampRoom("camp-17400407-22222222-bbbbbb222222", 2),
        _CampRoom("camp-17400407-33333333-cccccc333333", 3),
        _CampRoom("camp-17400407-44444444-dddddd444444", 4),
    ]
    assert (
        campaign_room_allowed_from_list("camp-17400407-44444444-dddddd444444", rooms)
        is True
    )


def test_campaign_never_blocks_solvox_test_rooms() -> None:
    """A Solvox test call must ring even if 3 campaign rooms are already live."""
    rooms = [
        _CampRoom("camp-17400407-11111111-aaaaaa111111", 1),
        _CampRoom("camp-17400407-22222222-bbbbbb222222", 2),
        _CampRoom("camp-17400407-33333333-cccccc333333", 3),
        _CampRoom("test-2e551bbd-20260904_125110_466836", 4),
    ]
    assert (
        campaign_room_allowed_from_list(
            "test-2e551bbd-20260904_125110_466836", rooms
        )
        is True
    )


def test_campaign_ignores_stale_empty_rooms_and_other_campaigns() -> None:
    now_ms = 200_000
    rooms = [
        _CampRoom(
            "camp-aaaaaaaa-11111111-oldold111111",
            creation_time=1,
            num_participants=0,
            creation_time_ms=1,
        ),
        _CampRoom(
            "camp-17400407-11111111-stale1111111",
            creation_time=1,
            num_participants=0,
            creation_time_ms=1,
        ),
        _CampRoom(
            "camp-17400407-22222222-stale2222222",
            creation_time=1,
            num_participants=0,
            creation_time_ms=1,
        ),
        _CampRoom(
            "camp-17400407-33333333-stale3333333",
            creation_time=1,
            num_participants=0,
            creation_time_ms=1,
        ),
        _CampRoom("test-2e551bbd-20260904_125110_466836", 1),
        _CampRoom(
            "camp-17400407-0911723d-fresh5555555",
            creation_time=199,
            num_participants=1,
            creation_time_ms=199_000,
        ),
    ]
    assert (
        campaign_room_allowed_from_list(
            "camp-17400407-0911723d-fresh5555555",
            rooms,
            now_ms=now_ms,
        )
        is True
    )


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


def test_ensure_room_recording_still_supplements_when_egress_attached(
    monkeypatch, patched_livekit
) -> None:
    """Auto-track may already be recording the SIP caller; still start agent + mixed."""
    monkeypatch.setattr(agent, "_list_room_egress", _async_return(["job-1"]))
    active, needs_fallback = asyncio.run(ensure_room_recording("room1"))
    assert active is True
    assert needs_fallback is True
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
