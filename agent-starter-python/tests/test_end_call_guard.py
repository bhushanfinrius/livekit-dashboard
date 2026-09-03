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
    looks_like_busy_callback,
    looks_like_continue_invite,
    looks_like_not_interested,
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


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
