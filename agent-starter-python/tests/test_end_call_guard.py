import datetime
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from agent import (  # noqa: E402
    END_CALL_MIN_CONV_SECONDS,
    END_CALL_MIN_TURNS,
    end_call_allowed,
    history_lines_from_report,
    looks_like_busy_callback,
    looks_like_continue_invite,
    looks_like_not_interested,
    should_end_as_no_answer,
    uses_gemini_developer_api,
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
        transcript_parts=[f"Turn {index}" for index in range(END_CALL_MIN_TURNS)],
        conv_seconds=int(END_CALL_MIN_CONV_SECONDS) + 10,
    )
    allowed, _reason = end_call_allowed(state)
    assert allowed is True


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


def test_gemini_developer_api_detects_aiza_keys() -> None:
    assert uses_gemini_developer_api("AIzaSyDummyKeyForTest") is True
    assert uses_gemini_developer_api("") is False
    assert uses_gemini_developer_api("vertex-sa-not-aiza") is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
