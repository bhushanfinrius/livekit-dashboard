import asyncio
import datetime
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from agent import (  # noqa: E402
    END_CALL_MIN_CONV_SECONDS,
    END_CALL_MIN_TURNS,
    _agent_already_said_hello,
    _greet_prospect,
    _session_has_tts,
    _speak_opening_hello,
    end_call_allowed,
    history_lines_from_report,
    looks_like_busy_callback,
    looks_like_continue_invite,
    looks_like_farewell,
    looks_like_garbled_stt,
    looks_like_no_help_needed,
    looks_like_not_interested,
    should_end_as_no_answer,
)


class FakeState:
    def __init__(
        self,
        *,
        transcript_parts: list[str] | None = None,
        conv_seconds: int = 0,
        callee_hung_up: bool = False,
        amd_voicemail: bool = False,
    ) -> None:
        self.transcript_parts = transcript_parts or []
        self.callee_hung_up = callee_hung_up
        self.amd_voicemail = amd_voicemail
        now = datetime.datetime.now(datetime.timezone.utc)
        self.connected_at = now - datetime.timedelta(seconds=conv_seconds)
        self.started_at = self.connected_at

    def conversation_duration_seconds(self) -> int:
        if not self.connected_at:
            return 0
        return int(
            (datetime.datetime.now(datetime.timezone.utc) - self.connected_at).total_seconds()
        )


def test_continue_invite_phrases() -> None:
    assert looks_like_continue_invite("जी बोलिए।")
    assert looks_like_continue_invite("hello")
    assert looks_like_continue_invite("go ahead")
    assert not looks_like_not_interested("जी बोलिए।")
    assert looks_like_busy_callback("I'm busy, call back at 2:30")
    assert looks_like_busy_callback("बाद में call करना")


def test_blocks_end_call_on_go_ahead() -> None:
    state = FakeState(
        transcript_parts=[
            "Kinjal (Lumiverse): Hello.",
            "Prospect: जी बोलिए।",
        ],
        conv_seconds=3,
    )
    allowed, reason = end_call_allowed(state)
    assert allowed is False
    assert "continue" in reason.lower()


def test_blocks_short_conversation() -> None:
    state = FakeState(
        transcript_parts=[
            "Kinjal (Lumiverse): Hello.",
            "Prospect: Yes I have an old car.",
        ],
        conv_seconds=5,
    )
    allowed, reason = end_call_allowed(state)
    assert allowed is False
    assert str(int(END_CALL_MIN_CONV_SECONDS)) in reason or "conversation" in reason.lower()


def test_blocks_few_turns() -> None:
    state = FakeState(
        transcript_parts=[
            "Kinjal (Lumiverse): Hello.",
            "Prospect: Yes.",
            "Kinjal (Lumiverse): Quick question about your vehicle.",
        ],
        conv_seconds=int(END_CALL_MIN_CONV_SECONDS) + 5,
    )
    allowed, reason = end_call_allowed(state)
    assert allowed is False
    assert str(END_CALL_MIN_TURNS) in reason


def test_allows_busy_callback() -> None:
    state = FakeState(
        transcript_parts=[
            "Kinjal (Lumiverse): Hello.",
            "Prospect: I'm busy, call me back at 2:30.",
        ],
        conv_seconds=5,
    )
    allowed, reason = end_call_allowed(state)
    assert allowed is True
    assert "call back" in reason.lower()
    state = FakeState(
        transcript_parts=[
            "Kinjal (Lumiverse): Hello.",
            "Prospect: Not interested, please don't call again.",
        ],
        conv_seconds=5,
    )
    allowed, reason = end_call_allowed(state)
    assert allowed is True
    assert "declined" in reason.lower()


def test_allows_after_minimum_conversation() -> None:
    state = FakeState(
        transcript_parts=[
            *(f"Turn {index}" for index in range(END_CALL_MIN_TURNS - 1)),
            "Prospect: Okay bye, thanks.",
        ],
        conv_seconds=int(END_CALL_MIN_CONV_SECONDS) + 10,
    )
    allowed, reason = end_call_allowed(state)
    assert allowed is True
    assert "farewell" in reason.lower()


def test_blocks_garbled_and_no_help() -> None:
    assert looks_like_garbled_stt("{} X {}")
    assert looks_like_garbled_stt("{ }")
    assert looks_like_no_help_needed("no need of help")
    assert looks_like_continue_invite("yeah yeah")
    assert looks_like_farewell("okay bye")
    long = FakeState(
        transcript_parts=[
            "Aarya: Hello.",
            "Prospect: Hello.",
            "Aarya: Calling about CyberX.",
            "Prospect: Yeah yeah.",
            "Aarya: Please complete payment.",
            "Prospect: {} X {}",
        ],
        conv_seconds=int(END_CALL_MIN_CONV_SECONDS) + 20,
    )
    allowed, reason = end_call_allowed(long)
    assert allowed is False
    assert "stt" in reason.lower() or "noise" in reason.lower()

    help_state = FakeState(
        transcript_parts=[
            "Aarya: Do you need any help with the payment?",
            "Prospect: No need of help.",
        ],
        conv_seconds=int(END_CALL_MIN_CONV_SECONDS) + 20,
    )
    allowed, reason = end_call_allowed(help_state)
    assert allowed is False
    assert "help" in reason.lower()


def test_blocks_min_conversation_without_goodbye() -> None:
    state = FakeState(
        transcript_parts=[f"Turn {index}" for index in range(END_CALL_MIN_TURNS)],
        conv_seconds=int(END_CALL_MIN_CONV_SECONDS) + 10,
    )
    allowed, reason = end_call_allowed(state)
    assert allowed is False
    assert "goodbye" in reason.lower() or "decline" in reason.lower()


def test_later_alone_is_not_busy_callback() -> None:
    assert not looks_like_busy_callback("later")
    assert not looks_like_busy_callback("ok later maybe")
    assert looks_like_busy_callback("call me back")
    assert looks_like_busy_callback("call me later")


def test_no_answer_only_without_remote_participants() -> None:
    assert should_end_as_no_answer([]) is True
    assert should_end_as_no_answer([""]) is True
    assert should_end_as_no_answer(["sip_918177938974"]) is False
    assert should_end_as_no_answer(["agent-AJ_abc", "sip_1"]) is False


def test_history_lines_from_session_report() -> None:
    lines = history_lines_from_report(
        {
            "chat_history": {
                "items": [
                    {"role": "assistant", "content": "Namaste, main Aarya bol rahi hoon."},
                    {"role": "user", "content": "Haan, boliye."},
                    {"role": "system", "content": "ignored"},
                ]
            }
        }
    )
    assert lines == [
        ("agent", "Aarya", "Namaste, main Aarya bol rahi hoon."),
        ("user", "Prospect", "Haan, boliye."),
    ]


def test_agent_hello_detection_ignores_prospect() -> None:
    state = FakeState(transcript_parts=["Prospect: Hello.", "Aarya: This is Aarya calling."])
    assert _agent_already_said_hello(state) is False
    state.transcript_parts.append("Aarya: Hello.")
    assert _agent_already_said_hello(state) is True


def test_session_without_tts_does_not_claim_say() -> None:
    class NoTts:
        tts = None

        def say(self, text):
            raise RuntimeError("should not be called")

    class WithTts:
        tts = object()

    assert _session_has_tts(NoTts()) is False
    assert _session_has_tts(WithTts()) is True


@pytest.mark.asyncio
async def test_speak_opening_hello_uses_generate_reply_without_tts() -> None:
    class FakeSession:
        tts = None
        say_calls = 0
        reply_calls = 0

        def say(self, text):
            self.say_calls += 1
            raise RuntimeError(
                "trying to generate speech from text without a TTS model or a "
                "RealtimeSession that supports say(); add a TTS model to AgentSession to enable say()"
            )

        def generate_reply(self, instructions=None):
            self.reply_calls += 1

            class Handle:
                async def wait_for_playout(self):
                    return None

            return Handle()

    session = FakeSession()
    await _speak_opening_hello(session)
    assert session.say_calls == 0
    assert session.reply_calls == 1


@pytest.mark.asyncio
async def test_greet_skips_when_gemini_already_said_hello(monkeypatch) -> None:
    import agent as agent_mod

    monkeypatch.setattr(agent_mod, "GREETING_HELLO_WAIT_SECONDS", 0.0)

    class FakeSession:
        tts = None
        reply_calls = 0

        def say(self, text):
            raise RuntimeError("say() must not run on Gemini Live")

        def generate_reply(self, instructions=None):
            self.reply_calls += 1
            raise AssertionError("generate_reply should be skipped")

    state = FakeState(transcript_parts=["Aarya: Hello."])
    state.room_name = "test-room"
    state._greeting_sent = False
    state._greeting_lock = asyncio.Lock()
    session = FakeSession()
    await _greet_prospect(session, state)
    assert state._greeting_sent is True
    assert session.reply_calls == 0


def test_vertex_live_strips_gemini_api_keys(monkeypatch) -> None:
    monkeypatch.setenv("GOOGLE_API_KEY", "AIzaSyShouldBeIgnored")
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaSyAlsoIgnored")
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", "solvoxai.json")
    from agent import (
        _prepare_vertex_env,
        GOOGLE_CLOUD_PROJECT,
        GOOGLE_CLOUD_LOCATION,
        GOOGLE_SERVICE_ACCOUNT_JSON,
    )

    _prepare_vertex_env()
    assert os.getenv("GOOGLE_API_KEY") is None
    assert os.getenv("GEMINI_API_KEY") is None
    assert os.getenv("GOOGLE_GENAI_USE_VERTEXAI") == "true"
    assert os.getenv("GOOGLE_CLOUD_PROJECT") == GOOGLE_CLOUD_PROJECT
    assert os.getenv("GOOGLE_CLOUD_LOCATION") == GOOGLE_CLOUD_LOCATION
    assert GOOGLE_CLOUD_PROJECT  # taken from livekit-storage.json when present
    assert GOOGLE_SERVICE_ACCOUNT_JSON == "livekit-storage.json"
    assert os.getenv("GOOGLE_APPLICATION_CREDENTIALS") == "livekit-storage.json"
    assert os.getenv("GCS_SERVICE_ACCOUNT_JSON") == "livekit-storage.json"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
