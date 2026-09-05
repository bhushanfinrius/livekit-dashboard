import asyncio
import datetime
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import agent  # noqa: E402


def _call_state(**overrides) -> SimpleNamespace:
    state = SimpleNamespace(
        room_name="camp-cooldown-test",
        contact_name="Test",
        org_name="Org",
        connected=True,
        connected_at=datetime.datetime.now(datetime.timezone.utc),
        transcript_parts=["Aarya: Hello.", "Prospect: Yes."],
        recording_active=True,
        recording_url=None,
        recording_urls=[],
        _call_end_handled=False,
        _call_ended_sent=False,
        _recording_finalized=False,
        _end_lock=asyncio.Lock(),
        _recording_lock=asyncio.Lock(),
        _max_duration_task=None,
        _shutdown_task=None,
        _background_audio=None,
        _egress_room_handlers=[],
        amd_voicemail=False,
        forced_outcome=None,
        forced_next_steps=None,
        forced_agent_notes=None,
        callee_hung_up=True,
        session=None,
        hangup_reason="",
    )
    state.full_transcript = lambda: "\n".join(state.transcript_parts)
    state.conversation_duration_seconds = lambda: 40
    state.duration_seconds = lambda: 45
    state.webhook_base = lambda: {
        "call_id": "c1",
        "room_name": state.room_name,
        "agent_name": "CTF-Agent",
    }
    for key, value in overrides.items():
        setattr(state, key, value)
    return state


def test_failed_egress_is_terminal() -> None:
    assert agent.egress_job_is_terminal(SimpleNamespace(status="EGRESS_FAILED")) is True
    assert (
        agent.egress_job_is_terminal(SimpleNamespace(status="EGRESS_ABORTED")) is True
    )
    assert (
        agent.egress_job_is_terminal(SimpleNamespace(status="EGRESS_COMPLETE")) is True
    )
    assert (
        agent.egress_job_is_terminal(SimpleNamespace(status="EGRESS_ACTIVE")) is False
    )


def test_deck_transcript_url_rejects_host_docker_internal(monkeypatch) -> None:
    monkeypatch.setattr(
        agent,
        "DECK_TRANSCRIPT_URL",
        "http://host.docker.internal:3000/api/projects/x/sessions/transcripts",
    )
    assert agent._deck_transcript_url_ok() is False


def test_deck_transcript_url_accepts_compose_deck_host(monkeypatch) -> None:
    monkeypatch.setattr(
        agent,
        "DECK_TRANSCRIPT_URL",
        "http://deck:3000/api/projects/x/sessions/transcripts",
    )
    assert agent._deck_transcript_url_ok() is True


@pytest.mark.asyncio
async def test_stop_room_egress_closes_api_when_stop_fails(monkeypatch) -> None:
    closed: list[bool] = []

    class FakeEgress:
        async def stop_egress(self, _req):
            raise RuntimeError("twirp error deadline_exceeded")

    class FakeAPI:
        def __init__(self, *args, **kwargs):
            del args, kwargs
            self.egress = FakeEgress()

        async def aclose(self):
            closed.append(True)

    monkeypatch.setattr(agent.api, "LiveKitAPI", FakeAPI)

    await agent.stop_room_egress("EG_test", "camp-cooldown-test")

    assert closed == [True]


@pytest.mark.asyncio
async def test_close_agent_session_times_out_hung_aclose() -> None:
    class HungSession:
        async def aclose(self):
            await asyncio.sleep(30)

    state = _call_state(session=HungSession(), recording_active=False)
    started = time.monotonic()
    await agent._close_agent_session(state)
    elapsed = time.monotonic() - started

    assert state.session is None
    assert elapsed < 4


@pytest.mark.asyncio
async def test_handle_call_end_returns_before_hung_finalize(monkeypatch) -> None:
    order: list[str] = []
    finalize_started = asyncio.Event()

    async def _webhook(payload):
        order.append(payload["event"])
        return True

    async def _finalize(state, *, emit_webhook=True):
        del emit_webhook
        finalize_started.set()
        order.append("recording_finalize_start")
        await asyncio.sleep(30)
        state._recording_finalized = True
        order.append("recording_finalize_done")

    async def _wait_start(state, timeout=30.0):
        del state, timeout
        order.append("wait_recording_start")

    async def _dump(*_args, **_kwargs):
        order.append("dump_transcript")

    async def _analyse(*_a, **_k):
        order.append("analyse")
        return {
            "outcome": "connected",
            "sentiment": "neutral",
            "sentiment_score": 50,
            "interest_level": 3,
            "key_topics": [],
            "next_steps": "",
            "agent_notes": "",
        }

    monkeypatch.setattr(agent, "send_webhook", _webhook)
    monkeypatch.setattr(agent, "_finalize_recording", _finalize)
    monkeypatch.setattr(agent, "_await_recording_start", _wait_start)
    monkeypatch.setattr(agent, "dump_session_report_to_deck", _dump)
    monkeypatch.setattr(agent, "get_job_context", lambda: None)
    monkeypatch.setattr(agent, "analyse_call", _analyse)
    monkeypatch.setattr(agent, "RECORDING_COOLDOWN_TIMEOUT", 0.2)

    state = _call_state()
    started = time.monotonic()
    await agent._handle_call_end(state)
    elapsed = time.monotonic() - started

    assert "call_ended" in order
    assert state._call_ended_sent is True
    assert elapsed < 2
    assert "recording_finalize_done" not in order
    await asyncio.wait_for(finalize_started.wait(), timeout=1)
    leftover = getattr(state, "_recording_task", None)
    if leftover is not None and not leftover.done():
        leftover.cancel()
        with pytest.raises(asyncio.CancelledError):
            await leftover


@pytest.mark.asyncio
async def test_shutdown_closes_session_before_deleting_room(monkeypatch) -> None:
    order: list[str] = []

    async def _handle(state):
        order.append("call_end")
        state._call_end_handled = True
        state._call_ended_sent = True

    async def _close_session(state):
        order.append("session_close")
        state.session = None

    async def _close_audio(state):
        order.append("audio_close")
        state._background_audio = None

    def _detach(state):
        order.append("detach_listeners")

    async def _hangup(*, delay_seconds=0):
        del delay_seconds
        order.append("hangup")

    monkeypatch.setattr(agent, "_handle_call_end", _handle)
    monkeypatch.setattr(agent, "_close_agent_session", _close_session)
    monkeypatch.setattr(agent, "_close_background_audio", _close_audio)
    monkeypatch.setattr(agent, "_detach_recording_listeners", _detach)
    monkeypatch.setattr(agent, "hangup_call", _hangup)

    state = _call_state(recording_active=False)
    await agent._complete_call_shutdown(state, hangup_now=True, reason="callee_left")

    assert order.index("call_end") < order.index("session_close")
    assert order.index("session_close") < order.index("hangup")
    assert order[-1] == "hangup"


@pytest.mark.asyncio
async def test_await_shutdown_returns_immediately_after_call_ended(monkeypatch) -> None:
    state = _call_state(
        _call_end_handled=True,
        _call_ended_sent=True,
        _shutdown_task=None,
        recording_active=False,
    )

    async def _boom(*_a, **_k):
        raise AssertionError("should not start another shutdown")

    monkeypatch.setattr(agent, "_complete_call_shutdown", _boom)
    started = time.monotonic()
    await agent._await_call_shutdown(state, None)
    assert time.monotonic() - started < 0.5
