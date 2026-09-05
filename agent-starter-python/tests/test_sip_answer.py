import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from agent import (  # noqa: E402
    resolved_call_outcome,
    sip_call_is_answered,
    sip_call_status,
    sip_leave_is_no_answer,
)


def _sip(status: str | None = None, extra: dict | None = None):
    attrs = {}
    if status is not None:
        attrs["sip.callStatus"] = status
    if extra:
        attrs.update(extra)
    return SimpleNamespace(attributes=attrs, identity="caller_918668641761")


def test_dialing_or_ringing_is_not_answered() -> None:
    assert sip_call_is_answered(_sip("dialing")) is False
    assert sip_call_is_answered(_sip("ringing")) is False
    assert sip_call_is_answered(_sip("hangup")) is False


def test_active_or_automation_is_answered() -> None:
    assert sip_call_is_answered(_sip("active")) is True
    assert sip_call_is_answered(_sip("automation")) is True
    assert sip_call_status(_sip("ACTIVE")) == "active"


def test_missing_call_status_is_not_answered() -> None:
    assert sip_call_is_answered(_sip()) is False
    assert (
        sip_call_is_answered(SimpleNamespace(attributes=None, identity="sip_x"))
        is False
    )


def test_leave_before_answer_is_no_answer_not_connected() -> None:
    state = SimpleNamespace(connected=False)
    assert sip_leave_is_no_answer(state) is True
    state.connected = True
    assert sip_leave_is_no_answer(state) is False


def test_unanswered_call_cannot_resolve_as_connected() -> None:
    state = SimpleNamespace(connected=False, amd_voicemail=False, forced_outcome=None)
    assert resolved_call_outcome(state, "connected") == "no_answer"
    assert resolved_call_outcome(state, "interested") == "no_answer"


def test_answered_call_keeps_analysis_outcome() -> None:
    state = SimpleNamespace(connected=True, amd_voicemail=False, forced_outcome=None)
    assert resolved_call_outcome(state, "connected") == "connected"
    assert resolved_call_outcome(state, "not_interested") == "not_interested"


def test_voicemail_overrides_unanswered() -> None:
    state = SimpleNamespace(
        connected=False, amd_voicemail=True, forced_outcome="voicemail"
    )
    assert resolved_call_outcome(state, "connected") == "voicemail"
