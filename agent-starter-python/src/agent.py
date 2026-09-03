"""
Mahindra car scraping agent — OPTIMIZED v8.0
Fixes applied vs v7.2:
  [C1]  GCS creds unified to single env var (GCS_SERVICE_ACCOUNT_JSON)
  [C2]  Recording stopped + URL resolved before call_ended; room deleted last
  [C3]  Voicemail via parallel STT (non-blocking); greet first, hang up on VM confirm
  [C4]  rag_retrieve wrapped in asyncio.to_thread — no event-loop blocking
  [C5]  analyse_call thread-pool timeout reduced + ThreadPoolExecutor sized
  [H6]  Webhook URLs read from env; localhost never used in production
  [H7]  Double call_ended race eliminated with single asyncio.Lock
  [H8]  MAX_CALL_SECONDS measured from connected_at, not room join
  [H9]  Assistant transcript captured via output_audio_transcription event
  [H10] Credit check fails-open on network error (logs warning, allows call)
  [H11] Session retry closes previous attempt before creating new one
  [H12] Chroma client protected by asyncio.Lock; to_thread for queries
  [H13] _deliver_closing_greeting guarded by asyncio.wait_for(timeout=15)
  [H14] GCS signed URL uses RSA-SHA256 signing + waits for upload before signing
  [M15] Date/time constants computed per-call inside entrypoint, not at import
  [M16] _parse_llm_json handles all fence/BOM variants from Gemini
  [M17] Disconnect debounce raised to 14 s (covers SIP re-register gaps)
  [M23] Auto track egress at CreateRoom (LiveKit Cloud style) — one file per published track
  [M21] end_call blocked on go-ahead phrases + minimum turns/duration before hangup
  [M22] AgentSession closed before room delete to reduce engine-is-closed log noise
"""

import logging
import asyncio
import os
import re
import json
import uuid
import datetime
import concurrent.futures
from typing import Optional
from dotenv import load_dotenv
import httpx

from livekit import api, rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    cli,
    room_io,
    get_job_context,
    llm,
    AudioConfig,
    BackgroundAudioPlayer,
    BuiltinAudioClip,
    ChatContext,
    ChatMessage,
    function_tool,
    RunContext,
)
from livekit.plugins import google
from livekit.plugins import silero
import chromadb
from livekit.plugins import sarvam, cartesia
from livekit.agents import inference   # or `from livekit.plugins import inference`, depending on your SDK version

logger = logging.getLogger("vCISO-v8")
logger.setLevel(logging.INFO)

load_dotenv(".env.local")
LANGUAGE_CODE = "hi-IN"
# ════════════════════════════════════════════════════════════════════════════════
# CONFIG
# ════════════════════════════════════════════════════════════════════════════════
def _env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes")

BACKEND_BASE_URL = (os.getenv("BACKEND_BASE_URL") or "https://uat-api.solvox.ai").strip()
_webhook_raw = (os.getenv("BACKEND_WEBHOOK_URL") or os.getenv("BACKEND_WEBHOOK_URLS") or "").strip()
if _webhook_raw:
    BACKEND_WEBHOOK_URLS = [item.strip() for item in _webhook_raw.split(",") if item.strip()]
else:
    BACKEND_WEBHOOK_URLS = [f"{BACKEND_BASE_URL.rstrip('/')}/api/webhook/call-event"]
API_BASE_URL          = BACKEND_BASE_URL
BACKEND_WEBHOOK_URL   = BACKEND_WEBHOOK_URLS[0] if BACKEND_WEBHOOK_URLS else ""
SKIP_CREDIT_CHECK     = _env_flag("SKIP_CREDIT_CHECK")
SKIP_BACKEND_WEBHOOKS = _env_flag("SKIP_BACKEND_WEBHOOKS")
DECK_TRANSCRIPT_URL   = os.getenv("DECK_TRANSCRIPT_URL", "").strip()
DECK_TRANSCRIPT_SECRET = os.getenv("DECK_TRANSCRIPT_SECRET", "").strip()
GOOGLE_API_KEY        = os.getenv("GOOGLE_API_KEY",        "")
GOOGLE_CLOUD_PROJECT  = os.getenv("GOOGLE_CLOUD_PROJECT",  "solvox-ai-007")
# India latency: prefer asia-south1 (Mumbai). Override to us-central1 only if the model is unavailable in India.
GOOGLE_CLOUD_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "asia-south1")

AGENT_NAME            = (os.getenv("AGENT_NAME") or "mahindra_scraping").strip() or "mahindra_scraping"
LIVEKIT_URL           = os.getenv("LIVEKIT_URL",        "")
LIVEKIT_API_KEY       = os.getenv("LIVEKIT_API_KEY",    "")
LIVEKIT_API_SECRET    = os.getenv("LIVEKIT_API_SECRET", "")

# Concurrency (Cloud-like capacity control). Default: 10 simultaneous jobs, 2 warm processes.
AGENT_MAX_CONCURRENT_JOBS = max(1, int(os.getenv("AGENT_MAX_CONCURRENT_JOBS", "10")))
AGENT_NUM_IDLE_PROCESSES = max(0, int(os.getenv("AGENT_NUM_IDLE_PROCESSES", "2")))
AGENT_LOAD_THRESHOLD = float(os.getenv("AGENT_LOAD_THRESHOLD", "1.0"))
AGENT_JOB_MEMORY_WARN_MB = float(os.getenv("AGENT_JOB_MEMORY_WARN_MB", "800"))

VOICEMAIL_DETECTION_ENABLED = os.getenv("VOICEMAIL_DETECTION_ENABLED", "true").lower() in ("1", "true", "yes")
SIP_JOIN_TIMEOUT            = float(os.getenv("SIP_JOIN_TIMEOUT") or os.getenv("AMD_SIP_JOIN_TIMEOUT") or "20")
BACKGROUND_AUDIO_ENABLED    = os.getenv("BACKGROUND_AUDIO_ENABLED", "true").lower() in ("1", "true", "yes")
BACKGROUND_AUDIO_VOLUME     = float(os.getenv("BACKGROUND_AUDIO_VOLUME", "0.8"))
RECORDING_FINALIZE_TIMEOUT  = float(os.getenv("RECORDING_FINALIZE_TIMEOUT", "120"))
_VOICEMAIL_AGENT_NOTES      = "Voice mail detected"

MAX_CALL_SECONDS      = int(os.getenv("MAX_CALL_SECONDS", "300"))
END_CALL_MIN_CONV_SECONDS = float(os.getenv("END_CALL_MIN_CONV_SECONDS", "15"))
END_CALL_MIN_TURNS        = int(os.getenv("END_CALL_MIN_TURNS", "4"))

# Prospect phrases that mean "keep talking" — never hang up on these.
_CONTINUE_INVITE_RE = re.compile(
    r"(?i)(जी\s*बोल(?:िए|ो|iye)|"
    r"बोल(?:िए|ो|iye)|"
    r"haan\s*bol(?:iye|o)|"
    r"go\s*ahead|"
    r"yes\s*,?\s*(go\s*on|speak|tell\s*me)|"
    r"^\s*hello[\.\!]?\s*$|"
    r"^\s*hi[\.\!]?\s*$|"
    r"tell\s+me|"
    r"continue|"
    r"और\s*बत(?:ाइए|ाओ)|"
    r"sun(?:o|iye)|"
    r"^\s*ह(?:ां|ाँ|aan)\s*[\.\!]?\s*$)"
)
_NOT_INTERESTED_RE = re.compile(
    r"(?i)(not\s+interested|don't\s+call|do\s+not\s+call|stop\s+calling|"
    r"no\s+thanks|remove\s+my\s+number|"
    r"interested\s+nahi|nahi\s+chahiye|"
    r"बाद\s*म(?:ै|е)?\s*call|"
    r"call\s*mat\s*karo|"
    r"don't\s+want|not\s+now)"
)
_BUSY_CALLBACK_RE = re.compile(
    r"(?i)("
    r"\bi['’]?m\s+busy\b|"
    r"call\s*(me\s+)?back|"
    r"callback|"
    r"call\s+me\s+later|"
    r"not\s+a\s+good\s+time|"
    r"abhi\s*(busy|time\s+nahi)|"
    r"phir\s+(se\s+)?call|"
    r"बाद\s*में\s*(call|फोन|phone)"
    r")"
)

# [C1] Single env var for GCS credentials used everywhere
GCS_SERVICE_ACCOUNT_JSON = os.getenv("GCS_SERVICE_ACCOUNT_JSON", "livekit-storage.json")
GCS_BUCKET_NAME          = os.getenv("GCS_BUCKET_NAME", "my_livekit_ecordings")

# [M23] Declarative egress at CreateRoom (LiveKit Cloud style):
#   room composite (audio_only) -> one mixed file for playback
#   auto track egress           -> one file per published track for analysis
ROOM_COMPOSITE_EGRESS_ENABLED = os.getenv("ROOM_COMPOSITE_EGRESS_ENABLED", "true").lower() in ("1", "true", "yes")
AUTO_TRACK_EGRESS_ENABLED = os.getenv("AUTO_TRACK_EGRESS_ENABLED", "true").lower() in ("1", "true", "yes")
AUTO_TRACK_EGRESS_FILEPATH = os.getenv(
    "AUTO_TRACK_EGRESS_FILEPATH",
    f"recordings/{AGENT_NAME}/{{room_name}}/{{publisher_identity}}-{{time}}.ogg",
)
RECORDING_FILE_EXT = ".ogg"
MIXED_RECORDING_SUFFIX = "-mixed"
_LLM_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="llm-analysis")

# ════════════════════════════════════════════════════════════════════════════════
# WEBHOOK  (3-attempt retry, fan-out)
# ════════════════════════════════════════════════════════════════════════════════
def _skip_backend_webhooks(payload: dict) -> bool:
    if SKIP_BACKEND_WEBHOOKS or not BACKEND_WEBHOOK_URLS:
        return True
    room = str(payload.get("room_name") or "")
    return room.startswith("deck-console-")


async def _send_to_one(url: str, payload: dict):
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.post(url, json=payload)
                r.raise_for_status()
                logger.info(f"✅ Webhook sent: {payload.get('event')} → {url} ({r.status_code})")
                return
        except Exception as e:
            logger.error(f"Webhook attempt {attempt+1}/3 failed [{url}]: {e}")
            if attempt < 2:
                await asyncio.sleep(1)

async def send_webhook(payload: dict):
    if _skip_backend_webhooks(payload):
        logger.info("Skipping backend webhook %s", payload.get("event"))
        return
    await asyncio.gather(*[_send_to_one(url, payload) for url in BACKEND_WEBHOOK_URLS])


def _deck_transcript_url_ok() -> bool:
    url = DECK_TRANSCRIPT_URL.lower()
    if not url:
        logger.error(
            "[deck-transcript] DECK_TRANSCRIPT_URL is empty — LumiVoice will not store transcripts"
        )
        return False
    if "localhost" in url or "127.0.0.1" in url:
        logger.error(
            "[deck-transcript] DECK_TRANSCRIPT_URL=%s cannot work from Docker. "
            "Use http://deck:3000/api/projects/<id>/sessions/transcripts",
            DECK_TRANSCRIPT_URL,
        )
        return False
    if "://deck:" not in url and "://deck/" not in url:
        logger.warning(
            "[deck-transcript] DECK_TRANSCRIPT_URL=%s is not the Compose deck host",
            DECK_TRANSCRIPT_URL,
        )
    return True


async def post_deck_transcript(room_name: str, speaker: str, identity: str, text: str) -> None:
    if not text.strip():
        return
    if not DECK_TRANSCRIPT_URL:
        logger.warning(
            "[deck-transcript] DECK_TRANSCRIPT_URL is empty — LumiVoice will not store this line"
        )
        return
    headers = {}
    if DECK_TRANSCRIPT_SECRET:
        headers["x-deck-transcript-secret"] = DECK_TRANSCRIPT_SECRET
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(
                DECK_TRANSCRIPT_URL,
                json={
                    "roomName": room_name,
                    "speaker": speaker,
                    "identity": identity,
                    "text": text.strip(),
                },
                headers=headers,
            )
            if resp.status_code >= 400:
                logger.warning(
                    "[deck-transcript] HTTP %s %s — %s",
                    resp.status_code,
                    DECK_TRANSCRIPT_URL,
                    resp.text[:200],
                )
            else:
                logger.debug("[deck-transcript] stored %s/%s", room_name, speaker)
    except Exception as exc:
        logger.warning("[deck-transcript] POST %s failed: %s", DECK_TRANSCRIPT_URL, exc)


def _deck_claim_url() -> str:
    url = DECK_TRANSCRIPT_URL.rstrip("/")
    if url.endswith("/sessions/transcripts"):
        return url[: -len("/sessions/transcripts")] + "/rooms/claim"
    return ""


async def register_deck_room(room_name: str) -> None:
    """Tell LumiVoice this room belongs to the transcript project so join webhooks ingest."""
    if not DECK_TRANSCRIPT_URL:
        logger.warning(
            "[deck-room] DECK_TRANSCRIPT_URL is empty — LumiVoice will not get transcripts or joins"
        )
        return
    claim = _deck_claim_url()
    if not claim:
        logger.warning("[deck-room] cannot derive claim URL from %s", DECK_TRANSCRIPT_URL)
        return
    headers = {}
    if DECK_TRANSCRIPT_SECRET:
        headers["x-deck-transcript-secret"] = DECK_TRANSCRIPT_SECRET
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(claim, json={"roomName": room_name}, headers=headers)
            if resp.status_code >= 400:
                logger.warning("[deck-room] HTTP %s: %s", resp.status_code, resp.text[:200])
            else:
                logger.info("[deck-room] registered %s", room_name)
    except Exception as exc:
        logger.warning("[deck-room] failed: %s", exc)


def _item_text(item) -> str:
    content = getattr(item, "content", None) or getattr(item, "text_content", None) or getattr(item, "text", None)
    if content is None and isinstance(item, dict):
        content = item.get("content") or item.get("text") or item.get("transcript")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                parts.append(str(block.get("text") or block.get("transcript") or ""))
            else:
                parts.append(str(getattr(block, "text", "") or ""))
        return " ".join(p for p in parts if p).strip()
    return str(content or "").strip()


def _history_items(report) -> list:
    data = report
    if hasattr(report, "to_dict"):
        try:
            data = report.to_dict()
        except Exception:
            data = report
    raw = None
    if isinstance(data, dict):
        raw = (
            data.get("chat_history")
            or data.get("history")
            or data.get("items")
            or data.get("events")
            or []
        )
    else:
        raw = (
            getattr(report, "chat_history", None)
            or getattr(report, "history", None)
            or getattr(report, "items", None)
            or []
        )
    if raw is not None and hasattr(raw, "to_dict") and not isinstance(raw, dict):
        try:
            raw = raw.to_dict()
        except Exception:
            pass
    if isinstance(raw, dict):
        raw = raw.get("items") or raw.get("messages") or raw.get("history") or []
    elif raw is not None and hasattr(raw, "items") and not isinstance(raw, list):
        raw = raw.items
    return list(raw or [])


def history_lines_from_report(report) -> list[tuple[str, str, str]]:
    """Map a SessionReport / history object to (speaker, identity, text) for LumiVoice."""
    if report is None:
        return []
    lines: list[tuple[str, str, str]] = []
    for item in _history_items(report):
        role = (getattr(item, "role", None) or (item.get("role") if isinstance(item, dict) else "") or "").lower()
        text = _item_text(item)
        if not text:
            continue
        if role in ("user", "prospect"):
            lines.append(("user", "Prospect", text))
        elif role in ("assistant", "agent"):
            lines.append(("agent", "Kinjal (Lumiverse)", text))
    return lines


def should_end_as_no_answer(remote_identities: list[str]) -> bool:
    """No-answer only when nobody else is in the room — not when SIP identity lookup missed."""
    return len([identity for identity in remote_identities if identity]) == 0


async def dump_session_report_to_deck(
    state: "CallState",
    session: Optional[AgentSession],
    ctx: Optional[JobContext],
) -> None:
    """Official Agents data-hook dump so LumiVoice still gets a transcript if live POSTs failed."""
    if getattr(state, "_transcript_dumped", False):
        return
    if not _deck_transcript_url_ok():
        return
    lines: list[tuple[str, str, str]] = []
    if ctx is not None and hasattr(ctx, "make_session_report"):
        try:
            report = ctx.make_session_report()
            lines = history_lines_from_report(report)
        except Exception as exc:
            logger.warning("[deck-transcript] make_session_report failed: %s", exc)
    if not lines and session is not None:
        history = getattr(session, "history", None)
        lines = history_lines_from_report(history)
    if not lines and state.transcript_parts:
        for part in state.transcript_parts:
            if ":" not in part:
                continue
            role, text = part.split(":", 1)
            speaker = "user" if role.strip().lower().startswith("prospect") else "agent"
            lines.append((speaker, role.strip(), text.strip()))
    if not lines:
        logger.warning("[deck-transcript] session report had no history lines")
        return
    state._transcript_dumped = True
    logger.info("[deck-transcript] dumping %s history line(s) to LumiVoice", len(lines))
    for speaker, identity, text in lines:
        await post_deck_transcript(state.room_name, speaker, identity, text)


# ════════════════════════════════════════════════════════════════════════════════
# CREDIT CHECK  [H10] — fail-open on network errors
# ════════════════════════════════════════════════════════════════════════════════
async def check_credits_allowed(agent_name: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"{API_BASE_URL}/api/agents/by-name/{agent_name}/credits/check"
            )
            if resp.status_code == 200:
                data         = resp.json()
                billing_mode = data.get("billing_mode", "unknown")
                has_credits  = data.get("has_credits", False)
                balance      = data.get("balance_seconds", 0)
                if billing_mode == "unlimited":
                    logger.info(f"[credit-check] UNLIMITED — bypassed (role={data.get('user_role')})")
                    return True
                allowed = bool(has_credits and balance > 0)
                logger.info(f"[credit-check] allowed={allowed} billing={billing_mode} balance={balance}s")
                return allowed
            logger.error(f"[credit-check] HTTP {resp.status_code}: {resp.text[:200]}")
            # [H10] Non-200 from our own API = unexpected — fail-open so calls aren't dropped
            logger.warning("[credit-check] Unexpected HTTP status — failing OPEN to avoid dropping call")
            return True
    except Exception as e:
        # [H10] Network unreachable on startup — fail-open with warning
        logger.warning(f"[credit-check] API unreachable ({e}) — failing OPEN")
        return True


# ════════════════════════════════════════════════════════════════════════════════
# SIP DISCONNECT HELPER
# ════════════════════════════════════════════════════════════════════════════════
async def disconnect_sip_participant(room_name: str, identity: str):
    try:
        lkapi = api.LiveKitAPI(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        await lkapi.room.remove_participant(
            api.RoomParticipantIdentity(room=room_name, identity=identity)
        )
        await lkapi.aclose()
        logger.info(f"[{room_name}] SIP participant '{identity}' removed")
    except Exception as e:
        logger.error(f"[{room_name}] Failed to remove SIP participant: {e}")


def _is_sip_callee_participant(participant: rtc.RemoteParticipant) -> bool:
    if participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
        return True
    identity = (participant.identity or "").lower()
    if any(t in identity for t in ("sip", "caller", "prospect", "test_")):
        return True
    digits = re.sub(r"\D", "", participant.identity or "")
    return len(digits) >= 10


# ════════════════════════════════════════════════════════════════════════════════
# EGRESS  [M23] declarative egress at CreateRoom + verify/fallback (Cloud parity)
# ════════════════════════════════════════════════════════════════════════════════
def _load_gcs_creds_json(room_name: str) -> Optional[str]:
    if not os.path.exists(GCS_SERVICE_ACCOUNT_JSON):
        logger.warning(
            f"[{room_name}] GCS creds not found: {GCS_SERVICE_ACCOUNT_JSON} — recording skipped"
        )
        return None
    with open(GCS_SERVICE_ACCOUNT_JSON) as f:
        return f.read()


def _auto_track_egress_filepath() -> str:
    return AUTO_TRACK_EGRESS_FILEPATH.replace("{AGENT_NAME}", AGENT_NAME)


def _mixed_egress_filepath(room_name: Optional[str] = None) -> str:
    """Template ({room_name}) for declarative egress, literal path when starting manually."""
    room = room_name or "{room_name}"
    return f"recordings/{AGENT_NAME}/{room}/{room}{MIXED_RECORDING_SUFFIX}{RECORDING_FILE_EXT}"


def _gcp_upload(gcs_creds_json: str):
    from livekit.protocol import egress as egress_proto

    return egress_proto.GCPUpload(credentials=gcs_creds_json, bucket=GCS_BUCKET_NAME)


def build_mixed_egress_request(gcs_creds_json: str, room_name: Optional[str] = None):
    """Room composite, audio_only. Never set layout/custom_base_url — that forces the
    job through the Chrome video pipeline and fails on audio-only SIP rooms."""
    from livekit.protocol import egress as egress_proto

    return egress_proto.RoomCompositeEgressRequest(
        room_name=room_name or "",
        audio_only=True,
        file_outputs=[
            egress_proto.EncodedFileOutput(
                filepath=_mixed_egress_filepath(room_name),
                gcp=_gcp_upload(gcs_creds_json),
            )
        ],
    )


def build_auto_track_egress(gcs_creds_json: str):
    from livekit.protocol import egress as egress_proto

    return egress_proto.AutoTrackEgress(
        filepath=_auto_track_egress_filepath(),
        gcp=_gcp_upload(gcs_creds_json),
    )


def build_room_egress(gcs_creds_json: str):
    """Single source of truth for the RoomEgress attached at room creation."""
    from livekit.protocol import room as room_proto

    egress = room_proto.RoomEgress()
    if ROOM_COMPOSITE_EGRESS_ENABLED:
        egress.room.CopyFrom(build_mixed_egress_request(gcs_creds_json))
    if AUTO_TRACK_EGRESS_ENABLED:
        egress.tracks.CopyFrom(build_auto_track_egress(gcs_creds_json))
    return egress


# ── Audio track discovery (used only by the manual fallback path) ──────────────
def _is_audio_publication(pub) -> bool:
    kind = getattr(pub, "kind", None)
    if kind is None:
        return False
    if hasattr(rtc, "TrackKind") and kind == rtc.TrackKind.KIND_AUDIO:
        return True
    name = getattr(kind, "name", None)
    return name == "KIND_AUDIO" or str(kind).endswith("AUDIO")


def _audio_track_sid(publication) -> Optional[str]:
    sid = getattr(publication, "sid", None)
    return sid.strip() if isinstance(sid, str) and sid.strip() else None


def _find_sip_audio_track_sid(room: rtc.Room) -> Optional[str]:
    for participant in room.remote_participants.values():
        if not _is_sip_callee_participant(participant):
            continue
        for pub in participant.track_publications.values():
            if _is_audio_publication(pub):
                sid = _audio_track_sid(pub)
                if sid:
                    return sid
    return None


def _find_local_audio_track_sid(room: rtc.Room) -> Optional[str]:
    local = room.local_participant
    if local is None:
        return None
    for pub in local.track_publications.values():
        if _is_audio_publication(pub):
            sid = _audio_track_sid(pub)
            if sid:
                return sid
    return None


async def _wait_for_audio_track_sid(
    room: rtc.Room,
    room_name: str,
    *,
    prefer_sip: bool,
    timeout: float = 30.0,
) -> Optional[str]:
    if prefer_sip:
        sid = _find_sip_audio_track_sid(room)
        if sid:
            logger.info(f"[{room_name}] SIP audio track ready — {sid}")
            return sid
    else:
        sid = _find_local_audio_track_sid(room)
        if sid:
            logger.info(f"[{room_name}] Agent audio track ready — {sid}")
            return sid

    loop = asyncio.get_running_loop()
    fut: asyncio.Future[str] = loop.create_future()

    @room.on("track_published")
    def _on_track_published(publication, participant):
        if fut.done() or not _is_audio_publication(publication):
            return
        if prefer_sip:
            if not isinstance(participant, rtc.RemoteParticipant):
                return
            if not _is_sip_callee_participant(participant):
                return
        elif participant is not room.local_participant:
            return
        track_sid = _audio_track_sid(publication)
        if track_sid:
            fut.set_result(track_sid)

    label = "SIP" if prefer_sip else "agent"
    try:
        track_sid = await asyncio.wait_for(fut, timeout=timeout)
        logger.info(f"[{room_name}] {label} audio track published — {track_sid}")
        return track_sid
    except asyncio.TimeoutError:
        logger.warning(f"[{room_name}] Timed out waiting for {label} audio track ({timeout:.0f}s)")
        return None


# ── Manual egress starters (fallback when declarative config never applied) ────
async def start_mixed_egress(room_name: str, gcs_creds_json: str) -> Optional[str]:
    try:
        lkapi = api.LiveKitAPI(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        try:
            result = await lkapi.egress.start_room_composite_egress(
                build_mixed_egress_request(gcs_creds_json, room_name)
            )
        finally:
            await lkapi.aclose()
        logger.info(
            f"[{room_name}] 🎬 Mixed egress started — egress_id={result.egress_id} → "
            f"gs://{GCS_BUCKET_NAME}/{_mixed_egress_filepath(room_name)}"
        )
        return result.egress_id
    except Exception as e:
        logger.error(f"[{room_name}] Failed to start mixed egress: {e}")
        return None


async def start_track_egress(
    room_name: str,
    track_id: str,
    identity: str,
    gcs_creds_json: str,
) -> Optional[str]:
    """Track egress writes the raw Opus track without transcoding."""
    from livekit.protocol import egress as egress_proto

    filepath = f"recordings/{AGENT_NAME}/{room_name}/{identity}-{{time}}{RECORDING_FILE_EXT}"
    try:
        lkapi = api.LiveKitAPI(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        try:
            result = await lkapi.egress.start_track_egress(
                egress_proto.TrackEgressRequest(
                    room_name=room_name,
                    track_id=track_id,
                    file=egress_proto.DirectFileOutput(
                        filepath=filepath,
                        gcp=_gcp_upload(gcs_creds_json),
                    ),
                )
            )
        finally:
            await lkapi.aclose()
        logger.info(
            f"[{room_name}] 🎬 Track egress started — egress_id={result.egress_id} "
            f"track={track_id} identity={identity}"
        )
        return result.egress_id
    except Exception as e:
        logger.error(f"[{room_name}] Failed to start track egress ({track_id}): {e}")
        return None


async def _start_manual_egress(room: rtc.Room, state: "CallState", gcs_creds_json: str) -> bool:
    """Fallback: room already existed without egress config, so start jobs ourselves."""
    started = False

    if ROOM_COMPOSITE_EGRESS_ENABLED and not state._call_end_handled:
        if await start_mixed_egress(state.room_name, gcs_creds_json):
            started = True

    if not AUTO_TRACK_EGRESS_ENABLED:
        return started

    prefer_sip = not state.is_console
    primary_sid = await _wait_for_audio_track_sid(
        room, state.room_name, prefer_sip=prefer_sip, timeout=30.0
    )
    if not primary_sid and prefer_sip:
        primary_sid = await _wait_for_audio_track_sid(
            room, state.room_name, prefer_sip=False, timeout=10.0
        )
    if state._call_end_handled:
        return started

    seen: set[str] = set()
    for participant in list(room.remote_participants.values()) + [room.local_participant]:
        if participant is None:
            continue
        identity = getattr(participant, "identity", "") or "participant"
        for pub in participant.track_publications.values():
            if not _is_audio_publication(pub):
                continue
            sid = _audio_track_sid(pub)
            if not sid or sid in seen:
                continue
            seen.add(sid)
            if await start_track_egress(state.room_name, sid, identity, gcs_creds_json):
                started = True

    if not seen:
        logger.warning(f"[{state.room_name}] ⚠️ No audio tracks found for fallback recording")
    return started


async def _run_recording_fallback(room: rtc.Room, state: "CallState") -> None:
    """Background task: start egress ourselves when the declarative config never applied."""
    try:
        gcs_creds_json = _load_gcs_creds_json(state.room_name)
        if not gcs_creds_json:
            state.recording_active = False
            return
        started = await _start_manual_egress(room, state, gcs_creds_json)
        state.recording_active = started
        if not started:
            logger.warning(
                f"[{state.room_name}] ⚠️ Recording not started — call continues without recording"
            )
    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.error(f"[{state.room_name}] Recording fallback failed: {e}", exc_info=True)


async def _await_recording_start(state: "CallState", timeout: float = 30.0) -> None:
    """Let the fallback task finish attaching egress before we finalize at call end."""
    task = state._recording_task
    if task is None or task.done():
        return
    try:
        await asyncio.wait_for(asyncio.shield(task), timeout=timeout)
    except asyncio.TimeoutError:
        logger.warning(
            f"[{state.room_name}] Egress start still pending after {timeout:.0f}s at call end"
        )
    except Exception as e:
        logger.warning(f"[{state.room_name}] Egress start task failed: {e}")


async def ensure_room_recording(room_name: str) -> tuple[bool, bool]:
    """Attach egress at room creation (Cloud pattern).

    Returns (recording_active, needs_fallback). A room created by SIP dispatch or an
    external dialer already exists here, and CreateRoom silently ignores the new egress
    config in that case, so the caller must run the fallback.
    """
    if not (ROOM_COMPOSITE_EGRESS_ENABLED or AUTO_TRACK_EGRESS_ENABLED):
        logger.info(f"[{room_name}] Recording disabled by config")
        return False, False

    gcs_creds_json = _load_gcs_creds_json(room_name)
    if not gcs_creds_json:
        return False, False

    from livekit.protocol import room as room_proto

    lkapi = api.LiveKitAPI(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
    try:
        await lkapi.room.create_room(
            room_proto.CreateRoomRequest(
                name=room_name,
                egress=build_room_egress(gcs_creds_json),
            )
        )
        logger.info(f"[{room_name}] 🎬 Room egress config submitted")
    except Exception as e:
        logger.info(f"[{room_name}] create_room for egress: {e}")
    finally:
        await lkapi.aclose()

    # CreateRoom is a no-op on an existing room, so trust list_egress, not the call above.
    jobs = await _list_room_egress(room_name)
    if jobs:
        logger.info(f"[{room_name}] ✅ Egress active — {len(jobs)} job(s) attached")
        return True, False

    logger.warning(
        f"[{room_name}] ⚠️ No egress attached (room pre-existed) — starting manual fallback"
    )
    return True, True


async def stop_room_egress(egress_id: str, room_name: str):
    if not egress_id:
        return
    try:
        lkapi = api.LiveKitAPI(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        from livekit.protocol import egress as egress_proto
        await lkapi.egress.stop_egress(egress_proto.StopEgressRequest(egress_id=egress_id))
        await lkapi.aclose()
        logger.info(f"[{room_name}] ⏹ Egress stopped — egress_id={egress_id}")
    except Exception as e:
        logger.error(f"[{room_name}] Failed to stop egress: {e}")


_EGRESS_DONE_STATUSES = {
    "EGRESS_COMPLETE",
    "EGRESS_FAILED",
    "EGRESS_ABORTED",
    "EGRESS_LIMIT_REACHED",
}


async def _list_room_egress(room_name: str) -> list:
    try:
        lkapi = api.LiveKitAPI(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        from livekit.protocol import egress as egress_proto

        result = await lkapi.egress.list_egress(
            egress_proto.ListEgressRequest(room_name=room_name)
        )
        await lkapi.aclose()
        return list(result.items)
    except Exception as e:
        logger.warning(f"[{room_name}] Could not list egress jobs: {e}")
        return []


async def _get_egress_info(egress_id: str, room_name: str):
    try:
        lkapi = api.LiveKitAPI(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        from livekit.protocol import egress as egress_proto

        result = await lkapi.egress.list_egress(
            egress_proto.ListEgressRequest(egress_id=egress_id)
        )
        await lkapi.aclose()
        if result.items:
            return result.items[0]
    except Exception as e:
        logger.warning(f"[{room_name}] Could not fetch egress info: {e}")
    return None


def _normalize_gcs_object_path(raw_path: str) -> Optional[str]:
    if not raw_path:
        return None
    path = raw_path.strip()
    if path.startswith("gs://"):
        _, _, remainder = path.partition("gs://")
        if "/" in remainder:
            return remainder.split("/", 1)[1]
        return None
    if "storage.googleapis.com/" in path:
        return path.split("storage.googleapis.com/", 1)[1].split("?", 1)[0]
    return path.lstrip("/")


def _egress_object_paths(item) -> list[str]:
    paths: list[str] = []
    for file_info in getattr(item, "file_results", None) or []:
        for candidate in (getattr(file_info, "filename", ""), getattr(file_info, "location", "")):
            normalized = _normalize_gcs_object_path(candidate)
            if normalized and normalized not in paths:
                paths.append(normalized)
    file_info = getattr(item, "file", None)
    if file_info is not None:
        for candidate in (getattr(file_info, "filename", ""), getattr(file_info, "location", "")):
            normalized = _normalize_gcs_object_path(candidate)
            if normalized and normalized not in paths:
                paths.append(normalized)
    return paths


_TRACK_SID_TOKEN = re.compile(r"^TR_[A-Za-z0-9]+$")
_TIME_TOKEN = re.compile(r"^\d+$|^\d{2}T\d{6}$")


def _publisher_identity_from_object_path(object_path: str) -> str:
    """Auto track egress writes `{publisher_identity}-{time}-{track_id}.ogg`, and {time}
    itself expands to a dashed ISO stamp, so strip trailing stamp/sid tokens."""
    basename = os.path.basename(object_path)
    stem, _ext = os.path.splitext(basename)
    tokens = stem.split("-")
    while len(tokens) > 1 and (
        _TRACK_SID_TOKEN.match(tokens[-1]) or _TIME_TOKEN.match(tokens[-1])
    ):
        tokens.pop()
    return "-".join(tokens)


_RECORDING_ROLE_ORDER = {"mixed": 0, "prospect": 1, "agent": 2}


def _recording_role_for_object_path(object_path: str) -> str:
    """mixed = room composite, prospect = callee/browser side, agent = our own audio."""
    basename = os.path.basename(object_path)
    stem, _ext = os.path.splitext(basename)
    if stem.endswith(MIXED_RECORDING_SUFFIX):
        return "mixed"

    identity = _publisher_identity_from_object_path(object_path).lower()
    if identity.startswith("deck-"):
        # LumiVoice Talk console: the browser participant is the prospect side.
        return "prospect"
    digits = re.sub(r"\D", "", identity)
    if identity.startswith("sip") or len(digits) >= 10:
        return "prospect"
    return "agent"


def _pick_primary_recording_url(recordings: list[dict]) -> Optional[str]:
    """Mixed plays both sides, so prefer it for playback."""
    for preferred in ("mixed", "prospect", "agent"):
        for entry in recordings:
            if entry.get("role") == preferred and entry.get("url"):
                return entry["url"]
    for entry in recordings:
        if entry.get("url"):
            return entry["url"]
    return None


async def _wait_for_egress_complete(
    egress_id: str,
    room_name: str,
    timeout: float = 45.0,
) -> list[str]:
    """Wait until LiveKit finishes uploading; return GCS object paths if known."""
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        item = await _get_egress_info(egress_id, room_name)
        if item is None:
            await asyncio.sleep(2)
            continue

        from livekit.protocol import egress as egress_proto

        status = egress_proto.EgressStatus.Name(item.status)
        object_paths = _egress_object_paths(item)

        if status == "EGRESS_COMPLETE":
            logger.info(
                f"[{room_name}] Egress upload complete — egress_id={egress_id}"
                + (f" paths={object_paths}" if object_paths else "")
            )
            return object_paths
        if status in _EGRESS_DONE_STATUSES - {"EGRESS_COMPLETE"}:
            logger.error(f"[{room_name}] Egress finished with status={status} id={egress_id}")
            return []
        await asyncio.sleep(2)

    logger.warning(
        f"[{room_name}] Timed out waiting for egress upload ({timeout:.0f}s) id={egress_id}"
    )
    return []


def _gcs_recording_object_candidates(room_name: str) -> list[str]:
    return [_mixed_egress_filepath(room_name)]


def _gcs_object_exists(object_path: str) -> bool:
    from urllib.parse import quote

    from google.auth.transport.requests import Request
    from google.oauth2 import service_account

    creds = service_account.Credentials.from_service_account_file(
        GCS_SERVICE_ACCOUNT_JSON,
        scopes=["https://www.googleapis.com/auth/devstorage.read_only"],
    )
    creds.refresh(Request())
    encoded = quote(object_path, safe="")
    url = f"https://storage.googleapis.com/storage/v1/b/{GCS_BUCKET_NAME}/o/{encoded}"
    with httpx.Client(timeout=10.0) as client:
        resp = client.get(url, headers={"Authorization": f"Bearer {creds.token}"})
    return resp.status_code == 200


async def _wait_for_gcs_object(
    room_name: str,
    *,
    object_path: Optional[str] = None,
    timeout: float = 45.0,
) -> Optional[str]:
    """Poll GCS until the egress file appears. Returns the object path found."""
    candidates: list[str] = []
    if object_path:
        candidates.append(object_path)
    candidates.extend(_gcs_recording_object_candidates(room_name))
    # Preserve order while removing duplicates
    seen: set[str] = set()
    unique_candidates = []
    for candidate in candidates:
        if candidate not in seen:
            seen.add(candidate)
            unique_candidates.append(candidate)

    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        for candidate in unique_candidates:
            exists = await asyncio.get_running_loop().run_in_executor(
                _LLM_EXECUTOR, _gcs_object_exists, candidate
            )
            if exists:
                logger.info(f"[{room_name}] GCS object ready — {candidate}")
                return candidate
        await asyncio.sleep(2)

    logger.error(
        f"[{room_name}] GCS object not found after {timeout:.0f}s — tried: "
        + ", ".join(unique_candidates)
    )
    return None


# ════════════════════════════════════════════════════════════════════════════════
# GCS SIGNED URL  [H14] — same as agent_corporate, with upload verification
# ════════════════════════════════════════════════════════════════════════════════
async def get_gcs_signed_url(
    room_name: str,
    *,
    object_path: Optional[str] = None,
    wait_timeout: float = 45.0,
) -> Optional[str]:
    """Generate a signed URL only after the recording exists in GCS."""
    import base64
    import time
    from urllib.parse import quote

    resolved_path = object_path or await _wait_for_gcs_object(
        room_name, object_path=object_path, timeout=wait_timeout
    )
    if not resolved_path:
        return None

    expiry_seconds = 7 * 24 * 3600  # 7 days

    if not os.path.exists(GCS_SERVICE_ACCOUNT_JSON):
        logger.error(f"GCS creds not found: {GCS_SERVICE_ACCOUNT_JSON}")
        return None

    try:
        with open(GCS_SERVICE_ACCOUNT_JSON) as f:
            creds = json.load(f)

        service_account_email = creds["client_email"]
        private_key_pem       = creds["private_key"]

        expiration = int(time.time()) + expiry_seconds
        string_to_sign = "\n".join([
            "GET",
            "",
            "",
            str(expiration),
            f"/{GCS_BUCKET_NAME}/{resolved_path}",
        ])

        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding

        private_key = serialization.load_pem_private_key(
            private_key_pem.encode(), password=None
        )
        signature = private_key.sign(
            string_to_sign.encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        encoded_sig = base64.b64encode(signature).decode()

        signed_url = (
            f"https://storage.googleapis.com/{GCS_BUCKET_NAME}/{quote(resolved_path)}"
            f"?GoogleAccessId={quote(service_account_email)}"
            f"&Expires={expiration}"
            f"&Signature={quote(encoded_sig)}"
        )

        logger.info(f"[{room_name}]  GCS signed URL generated")
        return signed_url

    except Exception as e:
        logger.error(f"[{room_name}]  Failed to generate signed URL: {e}")
        return None


# ════════════════════════════════════════════════════════════════════════════════
# POST-CALL ANALYSIS  — LLM-only classification (all outcomes)
# ════════════════════════════════════════════════════════════════════════════════
ANALYSIS_LLM_MODEL    = os.getenv("ANALYSIS_LLM_MODEL", "gemini-2.5-flash-lite").strip()
ANALYSIS_LLM_TIMEOUT  = float(os.getenv("ANALYSIS_LLM_TIMEOUT", "25"))

_ANALYSIS_SYSTEM_PROMPT = """You are a QA analyst reviewing a Lumiverse outbound sales call transcript (cybersecurity/compliance).
Calls may be in English, Hindi, Hinglish, or mixed. Classify using ONLY what the PROSPECT said — ignore agent pitches.

Outcomes — pick exactly ONE:

1. interested
   Prospect agreed to a meeting/demo AND date and/or time was shared or confirmed.
   OR prospect asked for pricing/proposal with clear intent to proceed.
   Requires explicit commitment — polite listening alone is NOT interested.

2. followup
   Prospect picked up and asked to be called back later / at a specific time.
   Examples: "call me tomorrow", "I'm in a meeting, call later", "abhi busy hoon".
   NOT a rejection. NOT interested (no meeting booked).

3. connected
   Prospect picked up and spoke briefly but there was no real sales conversation:
   only hello/yes/no/who-is-this, or call ended before pitch completed.
   No meeting, no callback request, no clear rejection.

4. not_interested
   Prospect clearly declined, said wrong person/number, said they don't handle this,
   asked not to be contacted, or ended with goodbye after rejecting.
   Examples: "not interested", "wrong person", "don't call again", "गलत जगह", "कॉल मत करना".

5. no_answer
   Call did not connect to a human conversation:
   no meaningful prospect speech, only agent spoke, callee hung up immediately,
   or line rang with no pickup. Use call metadata if transcript is empty.

6. voicemail
   Transcript shows an answering machine or voicemail greeting — not a live human.
   Examples: "leave a message after the beep", "not available", "at the tone",
   "please record your message", "voicemail box", Hindi VM phrases.
   If live_voicemail_detected=true in metadata, prefer voicemail.

Decision priority (when multiple seem possible):
  voicemail > no_answer > not_interested > interested > followup > connected

Rules:
- Do NOT invent meetings, dates, budgets, or agreements not in the transcript.
- interested requires date/time OR explicit demo/pricing commitment.
- followup requires explicit callback request — not vague "maybe".
- Rejection / wrong person / do-not-call → not_interested (never connected or followup).
- When unsure between interested and followup → followup with lower interest_level.
- When unsure between connected and not_interested → not_interested if any disinterest signal.

agent_notes (REQUIRED):
- 2-3 plain sentences describing WHAT ACTUALLY HAPPENED on the call.
- Summarize what the prospect said and how the call ended.
- Do NOT mention turn counts, word counts, or durations.

next_steps (REQUIRED):
- One actionable sentence for the sales team based on the outcome.
- not_interested / do-not-call → "Do not retry — prospect declined."
- followup → include when to call back if mentioned.
- interested → confirm meeting details.
- no_answer / voicemail → suggest retry timing.

Return JSON with keys:
outcome, sentiment (positive|neutral|negative), sentiment_score (0-100),
interest_level (0-10), key_topics (max 5 strings), next_steps, agent_notes

Return ONLY valid JSON, no markdown, no explanation."""


def _normalize_outcome(raw: str | None) -> str:
    s = (raw or "").strip().lower().replace(" ", "_").replace("-", "_")
    if "voicemail" in s or s in ("vm", "voice_mail"):
        return "voicemail"
    if s in ("no_answer", "noanswer", "unanswered"):
        return "no_answer"
    if s in ("not_interested", "notinterested", "declined", "rejected"):
        return "not_interested"
    if s in ("interested", "converted", "positive", "meeting_booked"):
        return "interested"
    if s in ("followup", "follow_up", "callback", "call_back"):
        return "followup"
    if s in ("connected", "contacted", "answered"):
        return "connected"
    return "connected"


def _build_analysis_user_content(
    *,
    transcript: str,
    contact_name: str,
    org_name: str,
    prospect_connected: bool,
    conv_duration: int,
    callee_hung_up: bool,
    live_voicemail_detected: bool,
) -> str:
    stats = _transcript_stats(transcript)
    transcript_block = transcript.strip() if transcript.strip() else "(empty — no speech captured)"
    return (
        f"Contact: {contact_name}\n"
        f"Organisation: {org_name}\n\n"
        f"--- CALL METADATA ---\n"
        f"prospect_connected: {prospect_connected}\n"
        f"conversation_duration_seconds: {conv_duration}\n"
        f"callee_hung_up: {callee_hung_up}\n"
        f"live_voicemail_detected: {live_voicemail_detected}\n"
        f"prospect_spoke: {stats['has_prospect_speech']}\n"
        f"--- END METADATA ---\n\n"
        f"--- TRANSCRIPT ---\n{transcript_block}\n--- END ---"
    )


def _transcript_stats(transcript: str) -> dict:
    prospect_lines: list[str] = []
    for line in (transcript or "").splitlines():
        stripped = line.strip()
        if stripped.lower().startswith("prospect:"):
            body = stripped.split(":", 1)[1].strip() if ":" in stripped else ""
            if body:
                prospect_lines.append(body)
    prospect_text = " ".join(prospect_lines)
    words = prospect_text.split()
    return {
        "prospect_turns": len(prospect_lines),
        "prospect_words": len(words),
        "prospect_text": prospect_text,
        "has_prospect_speech": len(words) >= 1,
    }


def _parse_llm_json(text: str) -> dict:
    """[M16] Handle all fence/BOM variants Gemini may produce."""
    raw = (text or "").strip()
    # Strip UTF-8 BOM if present
    raw = raw.lstrip("\ufeff")
    # Strip any combination of opening/closing triple-backtick fences
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\s*```\s*$", "", raw)
    # Strip trailing comma before closing brace (common Gemini quirk)
    raw = re.sub(r",\s*}", "}", raw)
    raw = raw.strip()
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("LLM response is not a JSON object")
    return parsed


def _clamp_int(value, low: int, high: int, default: int) -> int:
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return default


def _format_analysis(result: dict) -> dict:
    outcome   = _normalize_outcome(result.get("outcome"))
    interest  = _clamp_int(result.get("interest_level"), 0, 10, 0)
    sentiment = str(result.get("sentiment") or "neutral").strip().lower()
    if sentiment not in ("positive", "neutral", "negative"):
        sentiment = "neutral"
    score     = _clamp_int(result.get("sentiment_score"), 0, 100, 50)

    if outcome in ("no_answer", "voicemail"):
        interest, score, sentiment = 0, 50, "neutral"
    elif outcome == "connected":
        interest  = min(max(interest, 1), 3)
        sentiment = "neutral"
        score     = min(max(score, 40), 55)
    elif outcome == "followup":
        interest  = min(max(interest, 3), 6)
        sentiment = "neutral"
        score     = min(max(score, 45), 60)
    elif outcome == "interested":
        interest  = max(interest, 7)
        sentiment = "positive"
        score     = max(score, 65)
    elif outcome == "not_interested":
        interest  = min(interest, 2)
        sentiment = "negative"
        score     = min(score, 40)

    topics = result.get("key_topics")
    if not isinstance(topics, list):
        topics = []

    return {
        "outcome":         outcome,
        "sentiment":       sentiment,
        "sentiment_score": score,
        "interest_level":  interest,
        "key_topics":      [str(t).strip() for t in topics[:5] if str(t).strip()],
        "next_steps":      (result.get("next_steps") or "").strip() or "Review call and decide follow-up.",
        "agent_notes":     (result.get("agent_notes") or "").strip() or "Call completed — review transcript for details.",
    }


async def analyse_call(
    transcript: str,
    contact_name: str,
    org_name: str,
    *,
    prospect_connected: bool = False,
    conv_duration: int = 0,
    callee_hung_up: bool = False,
    live_voicemail_detected: bool = False,
) -> dict:
    """Classify call outcome entirely via LLM — no keyword heuristics."""
    user_content = _build_analysis_user_content(
        transcript=transcript,
        contact_name=contact_name,
        org_name=org_name,
        prospect_connected=prospect_connected,
        conv_duration=conv_duration,
        callee_hung_up=callee_hung_up,
        live_voicemail_detected=live_voicemail_detected,
    )

    def _run_gemini() -> dict:
        from google import genai as google_genai
        client = google_genai.Client(
            vertexai=True,
            project=GOOGLE_CLOUD_PROJECT,
            location=GOOGLE_CLOUD_LOCATION,
        )
        response = client.models.generate_content(
            model=ANALYSIS_LLM_MODEL,
            contents=user_content,
            config={
                "response_mime_type": "application/json",
                "temperature": 0.0,
                "system_instruction": _ANALYSIS_SYSTEM_PROMPT,
            },
        )
        return _format_analysis(_parse_llm_json(response.text))

    try:
        loop = asyncio.get_event_loop()
        formatted = await asyncio.wait_for(
            loop.run_in_executor(_LLM_EXECUTOR, _run_gemini),
            timeout=ANALYSIS_LLM_TIMEOUT,
        )
        logger.info(
            f"📊 Analysis: outcome={formatted.get('outcome')} "
            f"interest={formatted.get('interest_level')}/10"
        )
        return formatted
    except Exception as e:
        logger.error(f"Analysis failed (attempt 1): {e}")
        # One retry — still LLM-only, no keyword rules
        try:
            formatted = await asyncio.wait_for(
                loop.run_in_executor(_LLM_EXECUTOR, _run_gemini),
                timeout=ANALYSIS_LLM_TIMEOUT,
            )
            logger.info(f"📊 Analysis (retry): outcome={formatted.get('outcome')}")
            return formatted
        except Exception as e2:
            logger.error(f"Analysis failed (attempt 2): {e2}", exc_info=True)
            return {
                "outcome":         "connected" if prospect_connected else "no_answer",
                "sentiment":       "neutral",
                "sentiment_score": 50,
                "interest_level":  0,
                "key_topics":      [],
                "next_steps":      "Review call manually — automated analysis unavailable.",
                "agent_notes":     "Automated analysis could not complete. Please review the recording and transcript.",
            }


# ════════════════════════════════════════════════════════════════════════════════
# CALL STATE
# ════════════════════════════════════════════════════════════════════════════════
class CallState:
    def __init__(self, ctx: JobContext):
        self.room_name: str = ctx.room.name

        meta: dict = {}
        try:
            meta = json.loads(ctx.room.metadata or "{}")
        except Exception:
            pass
        if not meta.get("campaign_id"):
            try:
                meta = json.loads(ctx.job.metadata or "{}")
            except Exception:
                pass

        # Use backend call_id from room metadata (test/campaign calls) — not a random UUID
        self.call_id: str = (meta.get("call_id") or "").strip() or str(uuid.uuid4())

        logger.info(f"[{self.room_name}] Metadata: {meta}")

        self.campaign_id:    str = meta.get("campaign_id", "")
        self.lead_id:        str = meta.get("lead_id", "")
        self.contact_name:   str = meta.get("contact_name", "there")
        self.org_name:       str = meta.get("org_name", "your organisation")
        self.contact_number: str = meta.get("contact_number", "")

        explicit_type   = meta.get("call_type", "")
        self.call_type  = explicit_type if explicit_type else ("inbound" if not self.campaign_id else "outbound")
        self.is_inbound = self.call_type == "inbound"

        logger.info(f"[{self.room_name}] call_type={self.call_type} campaign_id={self.campaign_id or '(none)'}")

        self.mode: str = str(meta.get("mode") or "").strip().lower()
        self.is_console: bool = self.mode == "console" or (self.room_name or "").startswith("deck-console-")

        self.transcript_parts: list[str]             = []
        self.started_at:       Optional[datetime.datetime] = None
        self.connected_at:     Optional[datetime.datetime] = None
        self.connected:        bool                   = False
        self.forced_outcome:   Optional[str]          = None
        self.forced_next_steps: Optional[str]         = None
        self.forced_agent_notes: Optional[str]        = None
        self.session:          Optional[AgentSession] = None
        self.recording_active:    bool               = False
        self.recording_needs_fallback: bool          = False
        self.recording_url:    Optional[str]          = None
        self.recording_urls:   list[dict]             = []

        # State flags
        self._call_end_handled: bool             = False
        self._amd_closing:      bool             = False
        self.amd_voicemail:     bool             = False
        self.callee_hung_up:    bool             = False
        self._graceful_closing: bool             = False

        # [H7] Single lock to prevent double call_ended
        self._end_lock:         asyncio.Lock          = asyncio.Lock()

        self._max_duration_task: Optional[asyncio.Task] = None
        # [C2] Keep hard ref to recording task so GC doesn't collect it
        self._recording_task:      Optional[asyncio.Task] = None
        self._recording_finalized: bool                  = False
        self._recording_lock:       asyncio.Lock          = asyncio.Lock()
        self._shutdown_task:       Optional[asyncio.Task] = None
        self._greeting_sent:        bool                  = False
        self._greeting_lock:        asyncio.Lock          = asyncio.Lock()
        self._background_audio:     Optional[BackgroundAudioPlayer] = None
        self._vm_text_buffer:       str                   = ""
        self._vm_hangup_scheduled:  bool                  = False
        self.hangup_reason:         str                   = ""
        self._transcript_dumped:    bool                  = False

    def add_turn(self, role: str, text: str):
        if text.strip():
            self.transcript_parts.append(f"{role}: {text.strip()}")
            logger.info(f"[Transcript] {role}: {text.strip()[:120]}")
            speaker = "user" if role.lower().startswith("prospect") else "agent"
            try:
                asyncio.create_task(post_deck_transcript(self.room_name, speaker, role, text.strip()))
            except RuntimeError:
                pass

    def full_transcript(self) -> str:
        return "\n".join(self.transcript_parts)

    def duration_seconds(self) -> int:
        if not self.started_at:
            return 0
        return int((datetime.datetime.now(datetime.timezone.utc) - self.started_at).total_seconds())

    def conversation_duration_seconds(self) -> int:
        if not self.connected_at:
            return 0
        return int((datetime.datetime.now(datetime.timezone.utc) - self.connected_at).total_seconds())

    def webhook_base(self) -> dict:
        return {
            "call_id":        self.call_id,
            "call_type":      self.call_type,
            "campaign_id":    self.campaign_id or None,
            "lead_id":        self.lead_id or None,
            "contact_number": self.contact_number or None,
            "contact_name":   self.contact_name if self.contact_name not in ("", "there") else None,
            "org_name":       self.org_name if self.org_name not in ("", "your organisation") else None,
            "room_name":      self.room_name,
            "agent_name":     AGENT_NAME,
        }


# ════════════════════════════════════════════════════════════════════════════════
# POST-CALL HANDLER
# ════════════════════════════════════════════════════════════════════════════════
async def _collect_egress_recordings(state: CallState, egress_id: str) -> list[dict]:
    """Wait for one egress job then sign every file it produced."""
    object_paths = await _wait_for_egress_complete(egress_id, state.room_name, timeout=45.0)
    entries: list[dict] = []
    for object_path in object_paths:
        role = _recording_role_for_object_path(object_path)
        # The egress result already gives the final object path, so skip the GCS poll.
        recording_url = await get_gcs_signed_url(
            state.room_name,
            object_path=object_path,
            wait_timeout=0.0,
        )
        entries.append({
            "role": role,
            "egress_id": egress_id,
            "object_path": object_path,
            "url": recording_url or f"egress:{egress_id}",
        })
        if recording_url:
            logger.info(f"[{state.room_name}]  {role} recording URL ready")
    return entries


async def _finalize_recording(state: CallState, *, emit_webhook: bool = True) -> None:
    """Stop egress jobs, wait for GCS uploads, sign URLs, send recording_ready webhook."""
    if not state.recording_active:
        return

    async with state._recording_lock:
        if state._recording_finalized:
            return
        try:
            from livekit.protocol import egress as egress_proto

            items = await _list_room_egress(state.room_name)
            if not items:
                logger.warning(f"[{state.room_name}] No egress jobs found for room")
                return

            await asyncio.gather(*[
                stop_room_egress(item.egress_id, state.room_name)
                for item in items
                if egress_proto.EgressStatus.Name(item.status) not in _EGRESS_DONE_STATUSES
            ])

            # Jobs finish independently; waiting sequentially blows the finalize budget.
            results = await asyncio.gather(
                *[_collect_egress_recordings(state, item.egress_id) for item in items],
                return_exceptions=True,
            )

            recordings: list[dict] = []
            seen_paths: set[str] = set()
            for result in results:
                if isinstance(result, BaseException):
                    logger.warning(f"[{state.room_name}] Egress collect failed: {result}")
                    continue
                for entry in result:
                    if entry["object_path"] in seen_paths:
                        continue
                    seen_paths.add(entry["object_path"])
                    recordings.append(entry)

            recordings.sort(key=lambda entry: _RECORDING_ROLE_ORDER.get(entry["role"], 99))
            state.recording_urls = recordings
            state.recording_url = _pick_primary_recording_url(recordings)
        except Exception as e:
            logger.error(f"[{state.room_name}] Recording finalize failed: {e}")
        finally:
            state._recording_finalized = True

    if emit_webhook and state.recording_url:
        logger.info(
            f"[{state.room_name}] RECORDING_READY recording_url = {state.recording_url}"
        )
        await send_webhook({
            "event": "recording_ready",
            **state.webhook_base(),
            "recording_url": state.recording_url,
            "recording_urls": state.recording_urls,
        })
        logger.info(
            f"[{state.room_name}] ✅ recording_ready webhook sent "
            f"({len(state.recording_urls)} file(s): "
            f"{', '.join(entry['role'] for entry in state.recording_urls)})"
        )


async def _handle_call_end(state: CallState):
    async with state._end_lock:
        if state._call_end_handled:
            return
        state._call_end_handled = True

    _cancel_max_duration_timer(state)

    await _await_recording_start(state)

    if state.recording_active and not state._recording_finalized:
        try:
            await asyncio.wait_for(
                _finalize_recording(state),
                timeout=RECORDING_FINALIZE_TIMEOUT,
            )
        except asyncio.TimeoutError:
            logger.warning(
                f"[{state.room_name}] Recording finalize timed out ({RECORDING_FINALIZE_TIMEOUT:.0f}s)"
            )

    logger.info(f"[{state.room_name}] Call ended — running analysis...")

    ctx = get_job_context()
    await dump_session_report_to_deck(state, state.session, ctx)

    transcript    = state.full_transcript()
    conv_duration = state.conversation_duration_seconds()
    wall_duration = state.duration_seconds()

    logger.info(
        f"  Wall: {wall_duration}s | Conv: {conv_duration}s | "
        f"Turns: {len(state.transcript_parts)} | "
        f"callee_hung_up={state.callee_hung_up} amd_voicemail={state.amd_voicemail}"
    )
    if transcript:
        logger.info(f"  Transcript preview:\n{transcript[:500]}")
    else:
        logger.warning("  Empty transcript — check audio transcription events")

    if state.amd_voicemail and state.forced_outcome == "voicemail":
        outcome  = "voicemail"
        analysis = {
            "outcome":         "voicemail",
            "sentiment":       "neutral",
            "sentiment_score": 50,
            "interest_level":  0,
            "key_topics":      ["voicemail"],
            "next_steps":      state.forced_next_steps or "Answering machine detected — schedule a retry.",
            "agent_notes":     state.forced_agent_notes or _VOICEMAIL_AGENT_NOTES,
        }
    else:
        analysis = await analyse_call(
            transcript,
            state.contact_name,
            state.org_name,
            prospect_connected=state.connected,
            conv_duration=conv_duration,
            callee_hung_up=state.callee_hung_up,
            live_voicemail_detected=state.amd_voicemail,
        )
        outcome = _normalize_outcome(analysis.get("outcome"))

    if outcome in ("no_answer", "voicemail"):
        duration = 0
    elif state.connected_at:
        duration = conv_duration or wall_duration
    elif transcript.strip():
        duration = wall_duration
    else:
        duration = 0

    await send_webhook({
        "event":              "call_ended",
        **state.webhook_base(),
        "duration_seconds":   duration,
        "transcript":         transcript,
        "prospect_connected": state.connected,
        "outcome":            outcome,
        "sentiment":          analysis.get("sentiment", "neutral"),
        "sentiment_score":    analysis.get("sentiment_score", 50),
        "interest_level":     analysis.get("interest_level", 0),
        "key_topics":         analysis.get("key_topics", []),
        "next_steps":         analysis.get("next_steps", ""),
        "agent_notes":        analysis.get("agent_notes", ""),
        "recording_url":      state.recording_url,
        "recording_urls":     state.recording_urls,
    })

    logger.info(
        f"[{state.room_name}] CALL_ENDED recording_url = {state.recording_url}"
    )
    logger.info(
        f"[{state.room_name}] ✅ call_ended webhook sent — "
        f"outcome={outcome} duration={duration}s "
        f"recording={'yes' if state.recording_url else 'no'}"
    )


async def _complete_call_shutdown(
    state: CallState,
    *,
    delay_seconds: float = 0,
    hangup_now: bool = False,
    reason: str = "",
) -> None:
    """Finalize recording/analysis. Delete the SIP room first only on end_call / callee leave."""
    if reason:
        state.hangup_reason = reason
    if state._shutdown_task and not state._shutdown_task.done():
        await state._shutdown_task
        return
    if state._call_end_handled:
        if hangup_now:
            await hangup_call(delay_seconds=delay_seconds)
        return

    async def _run() -> None:
        try:
            logger.info(
                f"[{state.room_name}] hangup reason={state.hangup_reason or reason or 'unknown'} "
                f"hangup_now={hangup_now}"
            )
            if hangup_now:
                await hangup_call(delay_seconds=delay_seconds)
            await _handle_call_end(state)
            await _close_agent_session(state)
            if not hangup_now:
                await hangup_call(delay_seconds=delay_seconds)
            logger.info(f"[{state.room_name}] ✅ Call shutdown complete")
        except Exception as e:
            logger.error(f"[{state.room_name}] Shutdown failed: {e}", exc_info=True)
            raise

    state._shutdown_task = asyncio.create_task(
        _run(),
        name=f"shutdown-{state.room_name[:24]}",
    )
    await state._shutdown_task


async def _await_call_shutdown(state: CallState, session: Optional[AgentSession] = None) -> None:
    """Block until webhooks are sent — never exit the job early."""
    if state._shutdown_task and not state._shutdown_task.done():
        await state._shutdown_task
        return
    if state._call_end_handled:
        return
    if session and _had_conversation(state) and not state.callee_hung_up:
        await _graceful_call_shutdown(state, session, skip_farewell=False, reason="disconnect")
    else:
        await _complete_call_shutdown(state, hangup_now=True, reason="callee_left")


# ════════════════════════════════════════════════════════════════════════════════
# CHROMA RAG  [C4, H12] — async-safe, thread-offloaded
# ════════════════════════════════════════════════════════════════════════════════
CHROMA_API_KEY  = os.getenv("CHROMA_API_KEY",  "")
CHROMA_TENANT   = os.getenv("CHROMA_TENANT",   "default_tenant")
CHROMA_DATABASE = os.getenv("CHROMA_DATABASE", "lumiverse")

_chroma_client     = None
_chroma_collection = None
_chroma_lock       = asyncio.Lock()          # [H12] guard shared singleton

def _init_chroma_sync():
    """Synchronous Chroma init — always called from a thread."""
    global _chroma_client, _chroma_collection
    if _chroma_collection is not None:
        return
    if not CHROMA_API_KEY:
        logger.warning("⚠️ CHROMA_API_KEY not set — RAG disabled")
        return
    _chroma_client = chromadb.CloudClient(
        tenant=CHROMA_TENANT,
        database=CHROMA_DATABASE,
        api_key=CHROMA_API_KEY,
    )
    _chroma_collection = _chroma_client.get_or_create_collection(
        name="lumiverse_corporate_knowledge"
    )
    logger.info("✅ Connected to Chroma Cloud")


def _rag_retrieve_sync(query: str, n_results: int = 5) -> str:
    """Sync retrieval — run via to_thread."""
    _init_chroma_sync()
    if _chroma_collection is None:
        return ""
    results   = _chroma_collection.query(query_texts=[query], n_results=n_results)
    documents = results.get("documents", [[]])[0]
    return "\n\n".join([d.strip() for d in documents if d.strip()])


async def rag_retrieve(query: str, n_results: int = 5) -> str:
    """[C4] Non-blocking RAG — offloads sync Chroma I/O to thread pool."""
    if not CHROMA_API_KEY:
        return ""
    # [H12] Lock prevents concurrent init race
    async with _chroma_lock:
        try:
            return await asyncio.get_event_loop().run_in_executor(
                _LLM_EXECUTOR,
                _rag_retrieve_sync,
                query,
                n_results,
            )
        except Exception as e:
            logger.error(f"RAG error: {e}")
            return ""


# ════════════════════════════════════════════════════════════════════════════════
# HANGUP
# ════════════════════════════════════════════════════════════════════════════════
async def hangup_call(*, delay_seconds: float = 1.2):
    ctx = get_job_context()
    if ctx is None:
        logger.warning("No job context for hangup")
        return
    try:
        if delay_seconds > 0:
            await asyncio.sleep(delay_seconds)
        await ctx.api.room.delete_room(api.DeleteRoomRequest(room=ctx.room.name))
        logger.info("✅ Room deleted — call hung up")
    except Exception as e:
        if "not exist" in str(e).lower():
            logger.info("Room already deleted")
        else:
            logger.error(f"Hangup error: {e}")


_CLOSING_GREETING_INSTRUCTION = (
    "The call is ending now. Say ONE brief, warm closing goodbye in the same language "
    "the prospect has been using (English or Hinglish). Thank them for their time, "
    "mention you will follow up if needed, and wish them a good day. "
    "Do NOT ask any questions. Keep it under 15 seconds then stop."
)


async def _deliver_closing_greeting(session: AgentSession, room_name: str) -> None:
    """[H13] Closing greeting with hard timeout — never hangs the call."""
    try:
        handle = session.generate_reply(instructions=_CLOSING_GREETING_INSTRUCTION)
        await asyncio.wait_for(handle.wait_for_playout(), timeout=15.0)
        await asyncio.sleep(0.5)
        logger.info(f"[{room_name}] Closing greeting completed")
    except asyncio.TimeoutError:
        logger.warning(f"[{room_name}] Closing greeting timed out after 15s — proceeding to hangup")
    except Exception as e:
        logger.warning(f"[{room_name}] Closing greeting failed: {e}")


def _had_conversation(state: CallState) -> bool:
    if state.connected:
        return True
    return _transcript_stats(state.full_transcript())["has_prospect_speech"]


def _cancel_max_duration_timer(state: CallState) -> None:
    task = state._max_duration_task
    if task and not task.done():
        task.cancel()


async def _enforce_max_call_duration(state: CallState, session: AgentSession) -> None:
    """[H8] Cap measured from connected_at (prospect speech), not room join."""
    # Wait until we know when the conversation actually started
    while not state.connected_at and not state._call_end_handled:
        await asyncio.sleep(1)

    if state._call_end_handled:
        return

    elapsed   = (datetime.datetime.now(datetime.timezone.utc) - state.connected_at).total_seconds()
    remaining = MAX_CALL_SECONDS - elapsed
    if remaining > 0:
        await asyncio.sleep(remaining)

    if state._call_end_handled or state._amd_closing or state._graceful_closing:
        return

    logger.info(f"[{state.room_name}] ⏱️ Max conversation duration ({MAX_CALL_SECONDS}s) reached")
    state.forced_agent_notes = f"Call auto-ended after {MAX_CALL_SECONDS // 60}-minute conversation limit."
    state.forced_next_steps  = "Review call recording and follow up if needed."

    if _had_conversation(state):
        await _graceful_call_shutdown(state, session, skip_farewell=False, reason="max_duration")
    else:
        await _complete_call_shutdown(state, reason="max_duration")


async def _graceful_call_shutdown(
    state: CallState,
    session: Optional[AgentSession],
    *,
    skip_farewell: bool = False,
    reason: str = "normal",
) -> None:
    if state._call_end_handled:
        if state._shutdown_task and not state._shutdown_task.done():
            await state._shutdown_task
        return
    if state._shutdown_task and not state._shutdown_task.done():
        await state._shutdown_task
        return
    async with state._end_lock:
        if state._graceful_closing:
            return
        state._graceful_closing = True

    _cancel_max_duration_timer(state)

    if session and not skip_farewell and _had_conversation(state):
        await _deliver_closing_greeting(session, state.room_name)

    hangup_now = reason in ("end_call", "end_call_tool", "callee_left", "disconnect")
    await _complete_call_shutdown(state, delay_seconds=0, hangup_now=hangup_now, reason=reason)


# ════════════════════════════════════════════════════════════════════════════════
# AGENT INSTRUCTIONS  [M15] date injected at call-time, not import-time
# ════════════════════════════════════════════════════════════════════════════════
def build_agent_instructions() -> str:
    """[M15] Called per-session so date/time are always current."""
    today      = datetime.datetime.now()
    date_str   = today.strftime("%d %B %Y")
    day_str    = today.strftime("%A")
    time_str   = today.strftime("%H:%M")
    # Tomorrow for default slot suggestion
    tomorrow   = today + datetime.timedelta(days=1)
    # Skip to Monday if tomorrow is weekend
    if tomorrow.weekday() == 5:  # Saturday
        tomorrow += datetime.timedelta(days=2)
    elif tomorrow.weekday() == 6:  # Sunday
        tomorrow += datetime.timedelta(days=1)
    tmrw_str   = tomorrow.strftime("%A, %d %B %Y")

    return f"""
# SYSTEM INSTRUCTIONS: GEMINI REALTIME VOICE AGENT (Kinjal) — MAHINDRA ACCELO OUTBOUND B2B CONSULTANT

## 👤 ROLE & IDENTITY
- **Name:** Kinjal
- **Title:** Business Consultant / Procurement Solutions Executive at Mahindra Accelo.
- **Company:** Mahindra Accelo — A proud Mahindra Group company and India's leading supplier of Mobility and Energy components (automotive, EV, power/electrical stamping, steel processing) and operator of CERO, India's first organized vehicle recycling network.
- **Scenario:** You are on a LIVE, REAL-TIME OUTBOUND B2B COLD CALL right now. You are calling a corporate prospect (Procurement, Supply Chain, Manufacturing, or Engineering Decision Makers) to explore strategic alignment.
- **Current date:** {date_str} ({day_str}), {time_str} IST

---

🧠 THE MOST IMPORTANT THING TO UNDERSTAND

You are NOT writing. You are SPEAKING.
A real Indian business consultant, calm, corporate, and highly competent, talking on the phone.

Real Indian corporate B2B calls sound like this:
- Short. Professional. Clear. Efficient — you are talking to a busy executive; don't waste their time with sales pitches. Sound like an advisor.
- Mix of Hindi + English words mid-sentence, ONLY once the prospect has shown that's their language.
- Natural corporate fillers like "अच्छा", "हाँ जी", "ठीक है", "समझ गयी", "sure", "absolutely"
- Reactions before replies — a brief "अच्छा" or "got it" before addressing their point.
- "जी" added for corporate respect — "हाँ जी", "ठीक है जी".
- One question per turn. Then STOP and wait.

You NEVER sound like you're reading a telemarketing script.
You NEVER give a long monologue without pausing for the prospect.
You NEVER ask two questions in one turn.

---

🗣️ YOUR NATURAL VOICE — STUDY THESE EXAMPLES

❌ Robotic: "Thank you for taking my call. Mahindra Accelo Limited is a leading supplier of automotive components and EV solutions."
✅ Natural: "Hello..."
[wait for response]
"Haan ji, good [morning/afternoon]... actually this is Kinjal calling from Mahindra Accelo... am I speaking with the person handling procurement or supply chain?"

❌ Robotic: "Please provide your biggest pain point with your current component vendor."
✅ Natural: "अच्छा... just wanted to understand, what is the biggest challenge you are facing with your current component supplier right now?"

❌ Robotic: "I will now send you the company deck via email."
✅ Natural: "ठीक है... I can arrange for our engineering team to share our corporate profile and product specs... email ID confirm कर देंगे?"

LEAN INTO THIS. This is how a professional B2B peer actually talks.

---

🔊 YOUR FILLER WORD TOOLKIT

Reaction fillers (say these before replying):
→ "Achha..." / "Achha achha..." — when processing their operation size/needs
→ "Haan haan..." — when agreeing or validating an industry challenge
→ "Okay ji..." — polite corporate acknowledgment
→ "I see..." / "Got it..." — English equivalents when the call is in English

Mid-sentence fillers:
→ "matlab..." / "basically..." — meaning / basically
→ "vo kya hai na..." — the thing is...
→ "actually..." / "sure, absolutely" — very common in both English and Hinglish business talk.

When you need a moment to check your reference notes:
→ "Ek second..." / "One second, let me check..."

RULE: When you say a filler, pause after it. Don't rush through. Rotate your openers.

---

🌐 LANGUAGE HANDLING — DYNAMIC, PER-TURN, BOTH DIRECTIONS

- The call ALWAYS opens strictly in English ("Hello", then your introduction — see Call Flow Step 1 & 2).
- After that, you do NOT lock into one language. Instead, on EVERY single turn, silently detect which language THAT turn was spoken in — English, Hindi, or Hinglish (mixed) — and respond to it in that SAME language.
- This works in BOTH directions, as many times as the prospect switches:
  - Prospect speaks English -> you reply in English.
  - Prospect switches to Hindi/Hinglish mid-call -> your very next reply switches to Hinglish too.
  - Prospect switches back to English -> you switch back to English immediately. 
  - Treat natural professional code-switching as Hinglish.
- Numbers, specifications, and confirmations: read digits/units individually in whichever language the turn is in (e.g. "nine... eight..." in English, or "nau... aath..." in Hinglish).

---

🎙️ ACCENT & PRONUNCIATION (STRICT INDIAN ACCENT REQUIREMENT)

- You MUST strictly speak with a natural Indian English accent when using the English language. This must sound like an educated, professional corporate executive from India, not a westernized, American, or British agent.
- Keep the pace natural, measured, and unhurried — B2B conversations require a composed, consultative tone.
- When speaking English: use standard Indian corporate English phrasing, rhythm, and structural intonation (e.g., "please do the needful", "share the requirements", "explore synergies").
- Retroflex consonants (t, d, n) carry through naturally into English speech — this is normal Indian English pronunciation, do not suppress it. Do not adopt an American "flap t" (e.g., "wa-der").
- Accent compatibility: keep the accent consistently Indian across the whole call, folding in Hindi words naturally during Hinglish turns without shifting your voice character "modes."

---

🛡️ STRICT SCOPE PROTECTION RULE

If the caller or prospect asks about anything other than Mahindra Accelo, or brings up unrelated companies, competitors, general personal questions, or off-topic queries, you MUST NOT answer them or provide outside information. You will strictly deflect the query using the following phrase, adapted to their active language turn:
- **English turn:** "I am only here... to help with Mahindra Accelo."
- **Hindi/Hinglish turn:** "मैं यहाँ... सिर्फ Mahindra Accelo से जुड़ी जानकारी और सहायता के लिए हूँ।"

Do not elaborate, do not give external details, and immediately pivot back to the core B2B flow if appropriate.

---

🧠 CONVERSATION RULES

- Ask only ONE question per turn. Always. Zero exceptions.
- After every question — STOP. Wait. Do not add anything.
- React first before giving information ("अच्छा... समझ गयी...").
- If the prospect asks "Who are you?" mid-flow: "जी... मैं Kinjal बोल रही हूँ... Mahindra Accelo से। Mahindra Accelo... Mahindra Group की company है... जो Mobility और Energy sectors के लिए... high-quality engineered components में specialize करती है।"
- Never lecture. Never monologue. Keep it highly interactive.

---

📞 CALL FLOW

━━━━━━━━━━━━━━━━━━━━
STEP 1 — Strict English Opening ("Hello First" Method)
━━━━━━━━━━━━━━━━━━━━

**Agent:** "Hello..."

*(Wait for confirmation.)*

**Agent:** "This is Kinjal... from Mahindra Accelo. We handle authorized vehicle scrapping and recycling... I'm calling regarding your vehicle... Is this a good time to talk?"

*(If yes, proceed. If no, ask for a callback time and close politely.)*

STOP and listen. From their reply to THIS line onward, apply the dynamic per-turn language handling — detect and match their language from here.

---

━━━━━━━━━━━━━━━━━━━━
STEP 2 — The Pitch (Dynamic language detection begins here)
━━━━━━━━━━━━━━━━━━━━

**Agent (in whichever language the customer's last turn was — example shown in Hinglish):**
"Government guidelines के मुताबिक... पुरानी या unfit गाड़ियाँ... जैसे fitness test fail, accident-damaged... या flood-damaged vehicles... उन्हें legally scrap करवाना ज़रूरी होता है.
Eligibility के हिसाब से... commercial vehicles 15 साल से ऊपर... और private vehicles 20 साल से ऊपर... scrapping के लिए eligible होती हैं.
इसी process में आपकी help करने के लिए... हमने आपको call किया है."

**Agent (English variant — use if customer's turns are staying in English):**
"As per government guidelines... old or unfit vehicles... such as those that fail their fitness test... or are accident or flood-damaged... need to be legally scrapped.
Eligibility is... commercial vehicles over 15 years old... and private vehicles over 20 years old.
We're calling... to guide you through this process."

STOP. Let them respond fully. Do not interrupt.

---

━━━━━━━━━━━━━━━━━━━━
STEP 3 — Value Proposition & Reassurance
━━━━━━━━━━━━━━━━━━━━

**Agent (Hinglish):**
"Mahindra Accelo के साथ vehicle scrap करने पर... आपको government-recognized Certificate of Deposit मिलता है... जिसे नई गाड़ी खरीदते समय... available benefits के लिए use किया जा सकता है.
पूरा process... authorized और transparent होता है... RC भी officially cancel हो जाती है... और vehicle का disposal... पूरी तरह legal process के तहत किया जाता है."

**Agent (English variant):**
"When you scrap with Mahindra Accelo... you receive a government-recognized Certificate of Deposit... which can be used to avail benefits... when purchasing a new vehicle.
The entire process is authorized and transparent... your RC gets officially cancelled... and every step is carried out... through a fully legal and compliant process."

---

━━━━━━━━━━━━━━━━━━━━
STEP 4 — Discovery & Data Collection (Mandatory before closing)
━━━━━━━━━━━━━━━━━━━━

Agent (Hinglish): "क्या मैं आपका पूरा नाम... जान सकती हूँ?"
Agent (English): "Could I get your full name... please?"
(Use whichever language matches the customer's last turn. Wait for answer, then continue collecting one field per turn — never combine into one turn.)

Fields to capture, one per turn:

Customer Name
Mobile Number (validate: 10 digits, starts with 6/7/8/9)
City / Location

Prompts for each field:

Mobile Number — Hinglish: "और... कौन-सा contact number रहेगा... जिस पर हमारी team... आपसे follow-up कर सके?" / English: "And... what's the best contact number... for our team to follow up on?"
City / Location — Hinglish: "आप... किस city से बात कर रहे हैं?" / English: "And... which city are you calling from?"

Number validation mechanics:

Must be exactly 10 digits, starting with 6, 7, 8, or 9.
If invalid, ask once more: "Sorry... शायद number पूरा capture नहीं हो पाया... क्या आप एक बार फिर से बता देंगे?... 10-digit का number होगा." / "Sorry... that number didn't quite come through... Could you repeat it, please?... It should be a 10-digit number."
If still invalid after 2 attempts, proceed without it to maintain professional rapport.

Summary Confirmation: Confirm back as ONE clean line before closing:

Hinglish: "Okay... just to confirm... [Name] जी... [City] से हैं... और आपका contact number है... [digits read out one by one]... सही है ना? हमारी team... आगे के process के लिए... आपसे जल्द ही connect करेगी."
English: "So... just to confirm... [Name]... based in [City]... and we'll reach you on... [digits read out one by one]... correct? Our team... will connect with you... for the further process."

STOP. Wait for explicit confirmation. Do NOT call end_call until this confirmation is received.

---

━━━━━━━━━━━━━━━━━━━━
STEP 5 — Objection Handling (English + Hinglish — mirror the customer's last turn)
━━━━━━━━━━━━━━━━━━━━

**"My car runs perfectly fine, why should I scrap it?"**
> Hinglish: "समझ सकती हूँ... गाड़ी mechanically ठीक हो सकती है। लेकिन... eligibility criteria cross होने के बाद... उसे roadworthy नहीं माना जाता... और penalty का risk भी रहता है। Vehicle scrap करने पर... आपको fair और transparent value भी मिलती है."
> English: "I understand... the vehicle may still be mechanically fine. But... once it crosses the eligibility criteria... it's no longer considered roadworthy... and there's a risk of penalties. Scrapping it with Mahindra Accelo... also ensures you receive... a fair and transparent value."

**"What documents do you need?"**
> Hinglish: "Process बहुत simple है... Individual owner के लिए... RC, Aadhaar, और address proof चाहिए। Company vehicle के लिए... RC, authorization letter... और company ID required होती है."
> English: "The process is quite simple... For an individual owner... we need the RC book... Aadhaar card... and address proof... along with a PAN card, if applicable.
For a company vehicle... we need the RC... an authorization letter... company ID... and GST details, if applicable."

**"Will I actually get money for this?"**
> Hinglish: "बिल्कुल... vehicle की value... उसके weight, metal content... और current scrap rates के आधार पर तय होती है। Exact amount... हमारी team inspection के बाद... confirm करेगी."
> English: "Absolutely... the value depends on... the vehicle's weight... metal content... and the current scrap rates. Our team... will confirm the exact amount... after the inspection."

**"Can financed / loan vehicles be scrapped?"**
> Hinglish: "जब तक... loan और ownership formalities पूरी नहीं हो जातीं... और required documents ready नहीं होते... तब तक vehicle scrap करना... possible नहीं है."
> English: "Until... all loan and ownership formalities are complete... and the required documents are ready... scrapping isn't possible."

**"Is this even legal / trustworthy?"**
> Hinglish: "बिल्कुल... Mahindra Accelo खुद... एक Authorized Vehicle Scrapping Facility operate करती है... और पूरा process... government regulations के अनुसार... किया जाता है."
> English: "Absolutely... Mahindra Accelo itself operates... an Authorized Vehicle Scrapping Facility... and the entire process... follows government regulations."

**"I'm not interested / not right now."**
> Hinglish: "कोई बात नहीं... मैं समझ सकती हूँ। क्या मैं... कुछ महीनों बाद... एक follow-up call कर सकती हूँ... जब आप इसके बारे में सोचना चाहें?"
> English: "No problem... I understand. Could I give you... a follow-up call... in a couple of months... in case you'd like to consider it then?"

**Strict Data Limit:** Never guess exact scrap payout amounts, tax/discount percentages, or government benefit figures. Say: "I don't want to give you an unconfirmed figure on that — let me route this through our team so they can confirm it accurately."

---

━━━━━━━━━━━━━━━━━━━━
STEP 6 — Closing / Conversion Transition
━━━━━━━━━━━━━━━━━━━━

Once the details are locked and confirmed, execute the exit:

**If interested / qualified:**
> Hinglish: "शुक्रिया... [Name] जी... मैंने आपकी details note कर ली हैं। हमारी team... आगे के process के लिए... आपसे जल्द ही connect करेगी।"
> English: "Thank you... [Name]. I've noted down your details... Our team will coordinate with you... for the pickup or inspection. Would... tomorrow... or sometime this week... work for you?"

**If not interested:**
> Hinglish: "कोई बात नहीं... आपका time देने के लिए... शुक्रिया। अगर future में... आप इसके बारे में consider करें... तो हम आपकी मदद के लिए... हमेशा available हैं। Have a great day!"
> English: "No problem at all... thank you for your time. If you reconsider this... in the future... we're here to help. Have a great day!"

**If busy / call back later:**
> Hinglish: "ठीक है जी... मैं [time] पर call करूँगी। आपका समय देने के लिए शुक्रिया। Have a good day!"
> English: "Of course... I'll call you back at [time]. Thank you for your time. Have a good day!"

Immediately after ANY closing goodbye (qualified, not interested, busy, or callback), call end_call in the SAME turn. Do not keep pitching. Do not wait for recording or analysis.

---

🚫 NEVER DO THIS

- Never open with a full introduction speech — say "Hello" first, wait, then introduce.
- Never open or introduce yourself in Hindi/Hinglish — Step 1 and Step 2 are always strictly English.
- Never ask two qualification questions in one turn.
- Never sound aggressive or pushy — keep the energy high-level, corporate, and consultative.
- Never guess scrap valuation amounts, tax/discount percentages, or government benefit figures.
- Never state a national legal threshold as universal if it's actually a city/state-specific rule (e.g., NCR plying bans vs. the central Scrappage Policy's fitness-based criteria) — this is a compliance and trust risk.
- Never call end_call before validating name + vehicle details + contact channel details unless the prospect is busy, asks to be called back, is not interested, or hangs up.
- Never call end_call when the prospect says go-ahead / listening phrases: "जी बोलिए", "hello", "haan boliye", "go ahead", "tell me", "continue", "suniye" — those mean KEEP TALKING.
- Never break the **Strict Scope Protection Rule** — do not assist with any information outside of Mahindra Accelo parameters.

---

🎯 ALWAYS STAY ON:
- Vehicle scrapping eligibility, process, and organizational capabilities (Authorized Vehicle Scrapping Facility, CoD, CERO recycling).
- Capturing name, vehicle details, and validated contact details before exit — unless they ask to stop or call back.
- After a spoken goodbye, calling end_call immediately so the phone hangs up.
- Seamlessly matching the prospect's language code turn by turn.

---

## User information (populate from call metadata / CRM lookup when available)
- Caller name (if already known): {{{{ caller_name }}}}
- Existing account / order reference (if known): {{{{ order_reference }}}}
- Prior interaction history (if known): {{{{ prior_notes }}}}
If these are blank, ask for them naturally instead of assuming.
"""


def _last_prospect_utterance(state: CallState) -> str:
    for line in reversed(state.transcript_parts):
        if line.startswith("Prospect:"):
            return line.split(":", 1)[1].strip()
    return ""


def looks_like_continue_invite(text: str) -> bool:
    cleaned = text.strip()
    if not cleaned:
        return False
    return bool(_CONTINUE_INVITE_RE.search(cleaned))


def looks_like_not_interested(text: str) -> bool:
    cleaned = text.strip()
    if not cleaned:
        return False
    return bool(_NOT_INTERESTED_RE.search(cleaned))


def looks_like_busy_callback(text: str) -> bool:
    cleaned = text.strip()
    if not cleaned:
        return False
    return bool(_BUSY_CALLBACK_RE.search(cleaned))


def end_call_allowed(state: CallState) -> tuple[bool, str]:
    """Return (allowed, reason). Blocks premature Gemini end_call on go-ahead phrases."""
    if state.callee_hung_up or state.amd_voicemail:
        return True, "system hangup"

    last = _last_prospect_utterance(state)
    if last and looks_like_continue_invite(last):
        return False, f"prospect asked you to continue ({last[:80]})"

    turns = len(state.transcript_parts)
    conv = state.conversation_duration_seconds()

    if last and looks_like_not_interested(last) and turns >= 2:
        return True, "prospect declined"

    if last and looks_like_busy_callback(last) and turns >= 2:
        return True, "prospect asked to call back"

    if conv < END_CALL_MIN_CONV_SECONDS:
        return False, (
            f"conversation only {conv}s "
            f"(minimum {END_CALL_MIN_CONV_SECONDS:.0f}s before end_call)"
        )
    if turns < END_CALL_MIN_TURNS:
        return False, (
            f"only {turns} transcript turns "
            f"(minimum {END_CALL_MIN_TURNS} before end_call)"
        )

    return True, "minimum conversation reached"


async def _close_agent_session(state: CallState) -> None:
    session = state.session
    if session is None:
        return
    state.session = None
    try:
        await session.aclose()
        logger.info(f"[{state.room_name}] Agent session closed")
    except Exception as e:
        logger.warning(f"[{state.room_name}] Agent session close: {e}")


# ════════════════════════════════════════════════════════════════════════════════
# AGENT CLASS
# ════════════════════════════════════════════════════════════════════════════════
class LumiverseSalesAgent(Agent):
    def __init__(self, state: CallState):
        super().__init__(instructions=build_agent_instructions())   # [M15]
        self._state          = state
        self.collected_data  = {"name": "", "industry": ""}
        self.rejection_count = 0

    async def on_enter(self):
        # Outbound: greet as soon as SIP joins (see _run_outbound_call_setup).
        if self._state.is_inbound:
            await _greet_prospect(self.session, self._state)

    @function_tool(
        name="end_call",
        description=(
            "Hang up after you have spoken a closing goodbye: details confirmed, "
            "not interested, busy, or call-back requested. "
            "Speak the goodbye first, then call this tool immediately. "
            "NEVER use when they say go ahead, जी बोलिए, hello, haan boliye, or tell me."
        ),
    )
    async def end_call(self, ctx: RunContext):
        if (
            self._state._call_end_handled
            or self._state._amd_closing
            or self._state._vm_hangup_scheduled
            or (self._state._shutdown_task and not self._state._shutdown_task.done())
        ):
            logger.info("🛑 end_call skipped — shutdown already in progress")
            return "Shutdown already in progress."

        allowed, reason = end_call_allowed(self._state)
        if not allowed:
            logger.warning(f"🛑 end_call blocked — {reason}")
            return f"Do not hang up yet: {reason}. Continue the pitch."

        logger.info(f"🛑 end_call triggered — {reason}")
        await ctx.wait_for_playout()
        await asyncio.sleep(0.5)
        await _graceful_call_shutdown(
            self._state,
            self.session,
            skip_farewell=True,
            reason="end_call",
        )
        return "Call ending."


# ════════════════════════════════════════════════════════════════════════════════
# RAG SETUP
# ════════════════════════════════════════════════════════════════════════════════
async def setup_rag(session: AgentSession):
    def handle_user_turn(turn_ctx: ChatContext, new_message: ChatMessage):
        asyncio.create_task(_process_rag(turn_ctx, new_message))

    async def _process_rag(turn_ctx: ChatContext, new_message: ChatMessage):
        try:
            user_text = new_message.content or ""
            if len(user_text.strip()) < 5:
                return
            # [C4] rag_retrieve is now async and non-blocking
            rag_context = await rag_retrieve(user_text, n_results=5)
            if rag_context.strip():
                turn_ctx.add_message(
                    role="assistant",
                    content=f"Relevant cybersecurity and compliance information:\n\n{rag_context}",
                )
                logger.info("✅ RAG context injected")
        except Exception as e:
            logger.error(f"RAG processing error: {e}")

    session.on("user_turn_completed", handle_user_turn)


# ════════════════════════════════════════════════════════════════════════════════
# GREETING
# ════════════════════════════════════════════════════════════════════════════════
_GREETING_INSTRUCTION = (
    'Say exactly one word to the caller: "Hello". '
    "Do not introduce yourself. Do not add any other words. Then stop and wait for them to respond."
)
GREETING_MAX_ATTEMPTS = int(os.getenv("GREETING_MAX_ATTEMPTS", "3"))
GREETING_PLAYOUT_TIMEOUT = float(os.getenv("GREETING_PLAYOUT_TIMEOUT", "20"))


async def _greet_prospect(session: AgentSession, state: CallState) -> None:
    async with state._greeting_lock:
        if state._greeting_sent:
            return

        logger.info(f"[{state.room_name}] Greeting prospect...")
        for attempt in range(1, GREETING_MAX_ATTEMPTS + 1):
            try:
                delay = 1.0 if attempt == 1 else min(2.0 * attempt, 6.0)
                await asyncio.sleep(delay)
                handle = session.generate_reply(instructions=_GREETING_INSTRUCTION)
                await asyncio.wait_for(
                    handle.wait_for_playout(),
                    timeout=GREETING_PLAYOUT_TIMEOUT,
                )
                state._greeting_sent = True
                logger.info(f"[{state.room_name}] Greeting completed (attempt {attempt})")
                return
            except asyncio.TimeoutError:
                logger.warning(
                    f"[{state.room_name}] Greeting timed out "
                    f"(attempt {attempt}/{GREETING_MAX_ATTEMPTS}) — Gemini may still be warming up"
                )
            except Exception as e:
                logger.warning(
                    f"[{state.room_name}] Greeting failed "
                    f"(attempt {attempt}/{GREETING_MAX_ATTEMPTS}): {e}"
                )

        logger.error(
            f"[{state.room_name}] Greeting failed after {GREETING_MAX_ATTEMPTS} attempts — call continues"
        )


# ════════════════════════════════════════════════════════════════════════════════
# VOICEMAIL DETECTION (parallel STT — does not block agent speech)
# ════════════════════════════════════════════════════════════════════════════════
_STRONG_VM_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"leave (?:a )?message after (?:the )?(?:beep|tone)",
        r"please leave (?:a )?(?:your )?message",
        r"not available(?: right now)?(?: to take your call)?",
        r"unavailable(?: right now)?(?: to take your call)?",
        r"cannot take your call",
        r"can't take your call",
        r"unable to take your call",
        r"at the tone",
        r"after the tone",
        r"after the beep",
        r"record your message",
        r"mailbox is full",
        r"voicemail",
        r"voice mail",
        r"forwarded to voicemail",
        r"forwarded to voice mail",
        r"answering machine",
        r"you have reached the voicemail",
        r"you(?:'ve| have) reached (?:the )?(?:voicemail|voice mail)",
        r"the person you (?:are trying to reach|called) is not available",
        r"the person you (?:are trying to reach|called) is unavailable",
        r"no one is available to take your call",
        r"please try again later",
        r"कृपया.*संदेश.*छोड़",
        r"टोन.*(?:बाद|के बाद).*संदेश",
        r"वॉइस(?:मेल)?",
        r"उपलब्ध नहीं",
    )
]

_WEAK_VM_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"^hello[,.!?\s]*$",
        r"^hi[,.!?\s]*$",
        r"^please (?:hold|wait)",
        r"^one moment",
        r"^just a (?:second|moment)",
    )
]


def _is_voicemail_greeting(text: str) -> bool:
    normalized = " ".join(text.lower().split())
    if not normalized:
        return False
    if any(p.search(normalized) for p in _STRONG_VM_PATTERNS):
        return True
    weak_hits = sum(1 for p in _WEAK_VM_PATTERNS if p.search(normalized))
    return weak_hits >= 2 and len(normalized.split()) <= 12


async def _end_call_as_voicemail_detected(state: CallState) -> None:
    if state._call_end_handled or state._amd_closing or state._vm_hangup_scheduled:
        return
    state._vm_hangup_scheduled = True
    state._amd_closing         = True
    state.amd_voicemail        = True
    state.forced_outcome       = "voicemail"
    state.forced_next_steps    = "Answering machine detected — schedule a retry."
    state.forced_agent_notes   = _VOICEMAIL_AGENT_NOTES
    _cancel_max_duration_timer(state)
    logger.info(f"[{state.room_name}] 📞 Voicemail detected — finalizing call")
    await _complete_call_shutdown(state, reason="voicemail")


async def _check_and_hangup_voicemail(state: CallState, text: str) -> None:
    if not VOICEMAIL_DETECTION_ENABLED or state.is_inbound:
        return
    if state._call_end_handled or state._amd_closing or state.amd_voicemail:
        return
    state._vm_text_buffer = f"{state._vm_text_buffer} {text}".strip()
    if not _is_voicemail_greeting(state._vm_text_buffer):
        return
    await _end_call_as_voicemail_detected(state)


def _sip_participant_identity(ctx: JobContext) -> Optional[str]:
    for participant in ctx.room.remote_participants.values():
        if _is_sip_callee_participant(participant):
            return participant.identity
    return None


async def _wait_for_sip_participant(ctx: JobContext, timeout: float) -> Optional[str]:
    found = _sip_participant_identity(ctx)
    if found:
        return found
    loop = asyncio.get_running_loop()
    fut: asyncio.Future[str] = loop.create_future()

    @ctx.room.on("participant_connected")
    def _on_connected(participant: rtc.RemoteParticipant):
        if fut.done():
            return
        if _is_sip_callee_participant(participant):
            fut.set_result(participant.identity)

    try:
        return await asyncio.wait_for(fut, timeout=timeout)
    except asyncio.TimeoutError:
        return _sip_participant_identity(ctx)


async def _maybe_greet_on_sip_join(
    session: AgentSession,
    state: CallState,
    participant: rtc.RemoteParticipant,
) -> None:
    if state.is_inbound or state._greeting_sent:
        return
    if not _is_sip_callee_participant(participant):
        return
    await asyncio.sleep(0.5)
    await _greet_prospect(session, state)


async def _run_outbound_call_setup(ctx: JobContext, session: AgentSession, state: CallState) -> None:
    """Wait for callee SIP join, greet immediately; voicemail checked in parallel via STT."""
    try:
        await asyncio.sleep(0.2)

        sip_identity = await _wait_for_sip_participant(ctx, SIP_JOIN_TIMEOUT)
        remotes = [p.identity for p in ctx.room.remote_participants.values() if p.identity]
        if not sip_identity and not should_end_as_no_answer(remotes):
            logger.info(
                f"[{state.room_name}] SIP identity not matched but remotes present {remotes} — not no-answer"
            )
            sip_identity = remotes[0]
        if not sip_identity:
            logger.info(f"[{state.room_name}] No remote participant within {SIP_JOIN_TIMEOUT:.0f}s")
            await _end_call_as_no_answer(state, "Callee did not pick up — no remote participant joined.")
            return

        logger.info(f"[{state.room_name}] SIP participant joined: {sip_identity}")
        await asyncio.sleep(1.0)
        await _greet_prospect(session, state)

        if VOICEMAIL_DETECTION_ENABLED:
            logger.info(f"[{state.room_name}] 🔍 Voicemail detection active (parallel STT, non-blocking)")
    except Exception as e:
        logger.error(f"[{state.room_name}] Outbound setup failed: {e}", exc_info=True)


async def _end_call_as_no_answer(state: CallState, reason: str) -> None:
    if state._call_end_handled or state._amd_closing:
        return
    state._amd_closing = True
    logger.info(f"[{state.room_name}] 📵 No answer — {reason}")
    _cancel_max_duration_timer(state)
    await _complete_call_shutdown(state, reason="no_answer")


# ════════════════════════════════════════════════════════════════════════════════
# ENTRYPOINT
# ════════════════════════════════════════════════════════════════════════════════
def _agent_load(agent_server: AgentServer) -> float:
    """Job-count load so the worker accepts up to AGENT_MAX_CONCURRENT_JOBS (not only CPU%)."""
    return min(len(agent_server.active_jobs) / float(AGENT_MAX_CONCURRENT_JOBS), 1.0)


server = AgentServer(
    load_threshold=AGENT_LOAD_THRESHOLD,
    load_fnc=_agent_load,
    # Prod SDK default is 20 idle processes — too heavy for typical VPS. Keep 1–2 warm.
    num_idle_processes=AGENT_NUM_IDLE_PROCESSES,
    job_memory_warn_mb=AGENT_JOB_MEMORY_WARN_MB,
)

_ACTIVE_CALLS: dict[str, CallState] = {}

async def on_session_end(ctx: JobContext) -> None:
    """LiveKit data hook: dump session.history even if live transcript POSTs failed."""
    room = getattr(getattr(ctx, "room", None), "name", "") or ""
    state = _ACTIVE_CALLS.pop(room, None)
    if state is None:
        class _Stub:
            room_name = room
            transcript_parts: list[str] = []
            session = None
            _transcript_dumped = False

        state = _Stub()
    try:
        await dump_session_report_to_deck(state, getattr(state, "session", None), ctx)
    except Exception as exc:
        logger.warning("[deck-transcript] on_session_end dump failed: %s", exc)


@server.rtc_session(agent_name=AGENT_NAME, on_session_end=on_session_end)
async def entrypoint(ctx: JobContext):
    logger.info(
        "🚀 Starting Lumiverse vCISO Sales Agent v8.0 (vertex=%s/%s max_jobs=%s)",
        GOOGLE_CLOUD_PROJECT,
        GOOGLE_CLOUD_LOCATION,
        AGENT_MAX_CONCURRENT_JOBS,
    )

    state = CallState(ctx)
    _ACTIVE_CALLS[state.room_name] = state
    _deck_transcript_url_ok()
    await register_deck_room(state.room_name)
    state.recording_active, state.recording_needs_fallback = await ensure_room_recording(
        state.room_name
    )

    # ── Extract inbound caller number ─────────────────────────────────────────
    if state.is_inbound and not state.contact_number:
        room_name_str = state.room_name or ""
        for part in room_name_str.replace("+", "").split("_"):
            digits = "".join(filter(str.isdigit, part))
            if len(digits) >= 10:
                state.contact_number = digits[-10:]
                logger.info(f"[{state.room_name}] Inbound caller (room-name): {state.contact_number}")
                break

        if not state.contact_number:
            for _ in range(20):
                for p in ctx.room.remote_participants.values():
                    attrs      = getattr(p, "attributes", {}) or {}
                    caller_num = (
                        attrs.get("sip.callFrom")
                        or attrs.get("sip.from")
                        or attrs.get("sip.phoneNumber")
                        or attrs.get("phone_number")
                        or attrs.get("phoneNumber")
                        or attrs.get("caller_id")
                    )
                    if not caller_num:
                        raw_identity = p.identity or ""
                        m = re.search(r"(\+\d{7,15})", raw_identity)
                        if m:
                            caller_num = m.group(1)
                        else:
                            digits = "".join(filter(str.isdigit, raw_identity))
                            if len(digits) >= 10:
                                caller_num = digits[-10:]
                            elif raw_identity.startswith("sip_"):
                                caller_num = raw_identity.replace("sip_", "")
                    if caller_num:
                        state.contact_number = caller_num
                        logger.info(f"[{state.room_name}] Inbound caller (participant): {caller_num}")
                        break
                if state.contact_number:
                    break
                await asyncio.sleep(0.5)

        if not state.contact_number:
            logger.warning(f"[{state.room_name}] Could not extract inbound caller number")

    # ── Credit check  [H10] fails-open ───────────────────────────────────────
    if not SKIP_CREDIT_CHECK and not state.is_console:
        if not await check_credits_allowed(AGENT_NAME):
            logger.warning(f"[{state.room_name}] No credits — rejecting call")
            for p in ctx.room.remote_participants.values():
                await disconnect_sip_participant(state.room_name, p.identity)
                break
            await send_webhook({
                "event":       "call_failed",
                **state.webhook_base(),
                "outcome":     "no_answer",
                "agent_notes": "Call rejected: agent has no credit balance.",
            })
            return
    elif SKIP_CREDIT_CHECK or state.is_console:
        logger.info(f"[{state.room_name}] Credit check skipped")

    # ── call_started webhook ──────────────────────────────────────────────────
    await send_webhook({"event": "call_started", **state.webhook_base()})
    state.started_at = datetime.datetime.now(datetime.timezone.utc)

    # ── Session creation  [H11] close previous attempt on retry ──────────────
    session: Optional[AgentSession] = None
    for attempt in range(1, 4):
        prev_session = session      # [H11] close zombie session from failed attempt
        try:
            session = AgentSession(
                llm=google.realtime.RealtimeModel(
                    model="gemini-live-2.5-flash-native-audio",
                    voice="Sulafat",
                    temperature=0.65,
                    modalities=["AUDIO"],
                    vertexai=True,
                    project=GOOGLE_CLOUD_PROJECT,
                    location=GOOGLE_CLOUD_LOCATION,
                ),
            )

            # ── Transcript tracking ──────────────────────────────────────────
            @session.on("user_input_transcribed")
            def on_user_transcribed(event):
                if not getattr(event, "is_final", True):
                    return
                text = getattr(event, "transcript", "") or ""
                if not text.strip():
                    return
                state.add_turn("Prospect", text)
                if VOICEMAIL_DETECTION_ENABLED and not state.is_inbound:
                    asyncio.create_task(_check_and_hangup_voicemail(state, text.strip()))
                if not state.connected:
                    state.connected    = True
                    state.connected_at = datetime.datetime.now(datetime.timezone.utc)
                    asyncio.create_task(send_webhook({
                        "event": "call_connected",
                        **state.webhook_base(),
                    }))

            # [H9] Use output_audio_transcription for assistant turns in audio-only mode
            @session.on("output_audio_transcription")
            def on_agent_transcribed(event):
                text = getattr(event, "transcript", "") or ""
                if text.strip():
                    state.add_turn("Kinjal (Lumiverse)", text)

            # Fallback: text content block (fires when modality includes text)
            @session.on("conversation_item_added")
            def on_conversation_item(event):
                item = getattr(event, "item", None)
                if item is None:
                    return
                role    = getattr(item, "role", "")
                content = getattr(item, "content", None) or getattr(item, "text_content", None)
                if content is None or role != "assistant":
                    return
                if isinstance(content, str):
                    text = content
                elif isinstance(content, list):
                    parts = []
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "text":
                            parts.append(block.get("text", ""))
                        elif isinstance(block, str):
                            parts.append(block)
                    text = " ".join(parts)
                else:
                    text = str(content)
                if text.strip():
                    state.add_turn("Kinjal (Lumiverse)", text)

            agent = LumiverseSalesAgent(state=state)
            await setup_rag(session)

            await session.start(
                agent=agent,
                room=ctx.room,
                room_options=room_io.RoomOptions(
                    delete_room_on_close=True,
                    audio_input=room_io.AudioInputOptions(
                        pre_connect_audio=True,
                        pre_connect_audio_timeout=3.0,
                        # noise_cancellation removed temporarily — DLL fails to load on this Windows machine (LoadLibraryExW)
                    ),
                    close_on_disconnect=False,
                ),
            )

            if BACKGROUND_AUDIO_ENABLED:
                try:
                    if state._background_audio is not None:
                        await state._background_audio.aclose()
                    state._background_audio = BackgroundAudioPlayer(
                        ambient_sound=AudioConfig(
                            BuiltinAudioClip.OFFICE_AMBIENCE,
                            volume=BACKGROUND_AUDIO_VOLUME,
                        ),
                    )
                    await state._background_audio.start(
                        room=ctx.room,
                        agent_session=session,
                    )
                    logger.info(
                        f"[{state.room_name}] 🔊 Background audio started "
                        f"(volume={BACKGROUND_AUDIO_VOLUME})"
                    )
                except Exception as bg_err:
                    logger.warning(
                        f"[{state.room_name}] Background audio failed — call continues: {bg_err}"
                    )
                    state._background_audio = None

            state.session = session
            state._max_duration_task = asyncio.create_task(
                _enforce_max_call_duration(state, session),
                name=f"max-duration-{state.room_name[:24]}",
            )
            if state.recording_needs_fallback and (
                state._recording_task is None or state._recording_task.done()
            ):
                state._recording_task = asyncio.create_task(
                    _run_recording_fallback(ctx.room, state),
                    name=f"egress-fallback-{state.room_name[:24]}",
                )
            logger.info(f"✅ Agent started successfully (max conversation: {MAX_CALL_SECONDS}s)")

            # [H11] Close previous zombie session after new one is running
            if prev_session is not None:
                try:
                    await prev_session.aclose()
                except Exception:
                    pass
            break

        except Exception as e:
            logger.warning(f"Attempt {attempt} failed: {e}")
            # [H11] Clean up this failed attempt's session object
            if session is not None:
                try:
                    await session.aclose()
                except Exception:
                    pass
                session = None
            if state._background_audio is not None:
                try:
                    await state._background_audio.aclose()
                except Exception:
                    pass
                state._background_audio = None
            if attempt < 3:
                await asyncio.sleep(2 ** attempt)
            else:
                await send_webhook({
                    "event":       "call_failed",
                    **state.webhook_base(),
                    "agent_notes": f"Session failed to start after 3 attempts: {e}",
                })
                raise

    # ── Outbound: greet on SIP join; voicemail checked in parallel from STT ──
    if not state.is_inbound and session is not None:
        asyncio.create_task(
            _run_outbound_call_setup(ctx, session, state),
            name=f"outbound-setup-{state.room_name[:24]}",
        )

    # ── Wait for disconnect  ─────────────────────────────────────────────────
    disconnected      = asyncio.Event()
    _disconnect_task: Optional[asyncio.Task] = None

    async def _end_call_after_hangup():
        """When callee leaves, finalize call — wait for any in-progress shutdown first."""
        await asyncio.sleep(3)
        if state._shutdown_task and not state._shutdown_task.done():
            await state._shutdown_task
            disconnected.set()
            return
        if state._call_end_handled:
            disconnected.set()
            return
        logger.info(f"[{state.room_name}] Callee left — sending call_ended webhook")
        try:
            await _await_call_shutdown(state, state.session)
        except Exception as e:
            logger.error(f"[{state.room_name}] Error ending call after hangup: {e}", exc_info=True)
        disconnected.set()

    @ctx.room.on("disconnected")
    def on_disconnected(*args):
        logger.info(f"[{state.room_name}] Room disconnected")

        async def _release_after_shutdown():
            if state._shutdown_task and not state._shutdown_task.done():
                try:
                    await state._shutdown_task
                except Exception as e:
                    logger.error(f"[{state.room_name}] Shutdown task error: {e}")
            disconnected.set()

        asyncio.create_task(_release_after_shutdown())

    @ctx.room.on("participant_connected")
    def on_participant_connected(participant):
        nonlocal _disconnect_task
        if not _is_sip_callee_participant(participant):
            return
        if _disconnect_task and not _disconnect_task.done():
            _disconnect_task.cancel()
            logger.info(f"[{state.room_name}] SIP rejoined — disconnect cancelled")
        if session is not None and not state.is_inbound:
            asyncio.create_task(
                _maybe_greet_on_sip_join(session, state, participant),
                name=f"sip-greet-{state.room_name[:24]}",
            )

    @ctx.room.on("participant_disconnected")
    def on_participant_disconnected(participant):
        nonlocal _disconnect_task
        if any(x in participant.identity.lower() for x in ["caller", "sip", "prospect", "test_"]):
            state.callee_hung_up = True
            logger.info(f"[{state.room_name}] SIP left (user hangup): {participant.identity}")
            if _disconnect_task is None or _disconnect_task.done():
                _disconnect_task = asyncio.create_task(_end_call_after_hangup())

    try:
        await disconnected.wait()
    finally:
        _cancel_max_duration_timer(state)
        if state._background_audio is not None:
            try:
                await state._background_audio.aclose()
            except Exception:
                pass
            state._background_audio = None
        if _disconnect_task and not _disconnect_task.done():
            try:
                await asyncio.wait_for(_disconnect_task, timeout=30.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass
        try:
            await asyncio.wait_for(
                _await_call_shutdown(state, state.session),
                timeout=120.0,
            )
        except asyncio.TimeoutError:
            logger.error(f"[{state.room_name}] Shutdown timed out — webhooks may be incomplete")
        await _close_agent_session(state)
        disconnected.set()
        logger.info(f"[{state.room_name}] Job exiting — call fully processed")


if __name__ == "__main__":
    cli.run_app(server)