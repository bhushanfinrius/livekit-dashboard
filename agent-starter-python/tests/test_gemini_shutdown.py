import asyncio
import datetime
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import agent  # noqa: E402
from agent import (  # noqa: E402
    _is_gemini_session_gone,
    _should_hangup_session_event,
)


def test_gemini_1006_is_session_gone() -> None:
    err = Exception("1006 None. abnormal closure [internal]")
    assert _is_gemini_session_gone(err) is True
    assert _is_gemini_session_gone("no close frame received or sent") is True


def test_gemini_goaway_is_session_gone() -> None:
    assert _is_gemini_session_gone(
        "Gemini server indicates disconnection soon. Time left: 57s"
    )
    assert _is_gemini_session_gone("LiveServerGoAway")
    wrapped = SimpleNamespace(error=Exception("go_away time_left=57s"))
    assert _is_gemini_session_gone(wrapped) is True


def test_teardown_noise_is_not_enough_to_hangup() -> None:
    assert _is_gemini_session_gone(Exception("duplicate egress")) is False
    assert _is_gemini_session_gone("room session transport is closed") is False


def test_session_error_close_should_hangup() -> None:
    ev = SimpleNamespace(
        reason=SimpleNamespace(value="error"),
        error=Exception("1006 None. abnormal closure"),
    )
    assert _should_hangup_session_event(ev) is True


def test_user_initiated_close_does_not_hangup() -> None:
    ev = SimpleNamespace(reason=SimpleNamespace(value="user_initiated"), error=None)
    assert _should_hangup_session_event(ev) is False


def test_job_shutdown_close_should_hangup() -> None:
    ev = SimpleNamespace(reason=SimpleNamespace(value="job_shutdown"), error=None)
    assert _should_hangup_session_event(ev) is True


@pytest.mark.asyncio
async def test_call_ended_is_sent_before_recording_finalize(monkeypatch) -> None:
    order: list[str] = []

    async def _webhook(payload):
        order.append(payload["event"])
        return True

    async def _finalize(state, *, emit_webhook=True):
        del emit_webhook
        order.append("recording_finalize")
        state.recording_url = "https://example.com/mixed.ogg"
        state.recording_urls = [{"role": "mixed", "url": state.recording_url}]
        state._recording_finalized = True

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

    state = SimpleNamespace(
        room_name="camp-local-test",
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
        _max_duration_task=None,
        amd_voicemail=False,
        forced_outcome=None,
        forced_next_steps=None,
        forced_agent_notes=None,
        callee_hung_up=True,
        session=None,
    )
    state.full_transcript = lambda: "\n".join(state.transcript_parts)
    state.conversation_duration_seconds = lambda: 40
    state.duration_seconds = lambda: 45
    state.webhook_base = lambda: {
        "call_id": "c1",
        "room_name": state.room_name,
        "agent_name": "CTF-Agent",
    }

    await agent._handle_call_end(state)

    assert order[0] == "dump_transcript"
    assert "call_ended" in order
    assert "recording_finalize" in order
    assert order.index("call_ended") < order.index("recording_finalize")
    assert order.index("call_ended") < order.index("wait_recording_start")
    assert state._call_ended_sent is True
