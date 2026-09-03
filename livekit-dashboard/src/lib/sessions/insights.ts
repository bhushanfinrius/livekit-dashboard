import type { EgressInfo } from "livekit-server-sdk";
import { toEgressSnapshot } from "@/lib/livekit/egress-dto";
import { asRecord } from "@/lib/overview/payload";
import {
  RECORDING_ROLE_ORDER,
  recordingRoleFromOutput,
  recordingRoleLabel,
} from "@/lib/sessions/recording-role";
import type {
  SessionRecording,
  SessionTranscriptLine,
  TranscriptSpeaker,
} from "@/lib/sessions/types";

function str(record: Record<string, unknown> | null, ...keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function num(record: Record<string, unknown> | null, ...keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function protoMs(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value > 1e15) return value / 1e6;
  if (value > 1e12) return value / 1e6;
  if (value > 1e10) return value / 1e6;
  return value;
}

function protoSeconds(value: number | null) {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  if (value > 1e15) return value / 1e9;
  if (value > 1e12) return value / 1e9;
  if (value > 1e9) return value / 1e9;
  if (value > 10_000) return value / 1e3;
  return value;
}

function protoIso(value: number | null) {
  if (value === null || value <= 0) return null;
  const date = new Date(protoMs(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function playableMediaUrl(location: string | null) {
  if (!location) return null;
  const trimmed = location.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

function speakerFor(
  identity: string | null,
  agentIdentities: Set<string>,
  explicit?: string | null,
): TranscriptSpeaker {
  const role = explicit?.trim().toLowerCase();
  if (role === "agent" || role === "assistant") return "agent";
  if (role === "user" || role === "human" || role === "caller") return "user";
  if (role === "system") return "system";
  if (identity && agentIdentities.has(identity)) return "agent";
  return "user";
}

function collectSegments(
  node: unknown,
  agentIdentities: Set<string>,
  fallbackIdentity: string | null,
  lines: SessionTranscriptLine[],
) {
  const record = asRecord(node);
  if (!record) return;

  const nested =
    record.transcription ??
    record.Transcription ??
    record.segments ??
    record.transcriptions;
  if (Array.isArray(nested)) {
    for (const item of nested) collectSegments(item, agentIdentities, fallbackIdentity, lines);
  } else if (nested) {
    collectSegments(nested, agentIdentities, str(record, "transcribedParticipantIdentity", "transcribed_participant_identity") ?? fallbackIdentity, lines);
  }

  const text = str(record, "text", "content", "transcript", "message");
  const isSegment = Boolean(
    text &&
      (record.startTime != null ||
        record.start_time != null ||
        record.endTime != null ||
        record.end_time != null ||
        record.final != null ||
        record.language != null ||
        record.offsetMs != null ||
        record.offset_ms != null ||
        record.role != null),
  );
  if (!isSegment || !text || record.final === false) return;

  const identity =
    str(record, "transcribedParticipantIdentity", "transcribed_participant_identity", "identity", "speaker", "role") ??
    fallbackIdentity;
  const start = num(record, "offsetMs", "offset_ms") ?? num(record, "startTime", "start_time") ?? 0;
  const startedRaw = record.startedAt ?? record.started_at;
  const at =
    typeof startedRaw === "string" && startedRaw.trim()
      ? startedRaw.trim()
      : protoIso(num(record, "startedAt", "started_at"));
  lines.push({
    id: str(record, "id") ?? `${identity ?? "line"}:${start}:${text.slice(0, 24)}`,
    speaker: speakerFor(identity, agentIdentities, str(record, "role", "speaker")),
    identity,
    text,
    offsetMs: start > 1e11 ? 0 : protoMs(start),
    at,
  });
}

export function parseSessionTranscripts(
  payloads: unknown[],
  agentIdentities: Set<string>,
): SessionTranscriptLine[] {
  const lines: SessionTranscriptLine[] = [];
  for (const payload of payloads) {
    const root = asRecord(payload);
    const eventType = str(root, "event", "eventType", "event_type") ?? "";
    const identity =
      str(asRecord(root?.participant), "identity") ?? str(root, "participantIdentity", "participant_identity");
    if (eventType.toLowerCase().includes("transcription") || root?.transcription || root?.segments) {
      collectSegments(payload, agentIdentities, identity, lines);
    }
    const chat = asRecord(root?.chatMessage) ?? asRecord(root?.chat_message);
    const chatText = str(chat, "message", "text");
    if (chatText) {
      const generated = chat?.generated === true || chat?.generatedByAgent === true;
      lines.push({
        id: str(chat, "id") ?? `chat:${identity ?? "unknown"}:${chatText.slice(0, 24)}`,
        speaker: generated ? "agent" : speakerFor(identity, agentIdentities, str(chat, "role")),
        identity,
        text: chatText,
        offsetMs: protoMs(num(chat, "timestamp", "createdAt", "created_at") ?? 0),
        at: protoIso(num(chat, "timestamp", "createdAt", "created_at")),
      });
    }
  }

  const seen = new Set<string>();
  return lines
    .filter((line) => {
      const textKey = `${line.speaker}:${line.text}`;
      if (seen.has(line.id) || seen.has(textKey)) return false;
      seen.add(line.id);
      seen.add(textKey);
      return line.text.length > 0;
    })
    .sort((a, b) => a.offsetMs - b.offsetMs || (a.at ?? "").localeCompare(b.at ?? ""));
}

const EGRESS_STATUS: Record<number, string> = {
  0: "starting",
  1: "active",
  2: "ending",
  3: "complete",
  4: "failed",
  5: "aborted",
  6: "limit reached",
};

function recordingFromJson(raw: unknown): SessionRecording | null {
  const root = asRecord(raw);
  const eventType = str(root, "event", "eventType", "event_type") ?? "";
  if (!root?.egressInfo && !root?.egress_info && !eventType.startsWith("egress")) return null;
  const info = asRecord(root?.egressInfo) ?? asRecord(root?.egress_info) ?? root;
  if (!info) return null;
  const id = str(info, "egressId", "egress_id");
  if (!id) return null;
  const file = asRecord(Array.isArray(info.fileResults) ? info.fileResults[0] : null)
    ?? asRecord(Array.isArray(info.file_results) ? info.file_results[0] : null)
    ?? asRecord(info.file)
    ?? asRecord(asRecord(info.result)?.file);
  const stream = asRecord(Array.isArray(info.streamResults) ? info.streamResults[0] : null)
    ?? asRecord(Array.isArray(info.stream_results) ? info.stream_results[0] : null);
  const output =
    str(file, "location", "filename") ??
    str(stream, "url") ??
    str(info, "manifestLocation", "manifest_location");
  const started = num(info, "startedAt", "started_at") ?? num(file, "startedAt", "started_at");
  const ended = num(info, "endedAt", "ended_at") ?? num(file, "endedAt", "ended_at");
  const duration = protoSeconds(num(file, "duration") ?? num(info, "duration"));
  const statusRaw = info.status;
  const status =
    typeof statusRaw === "string"
      ? statusRaw.replace(/^EGRESS_/i, "").toLowerCase().replaceAll("_", " ")
      : typeof statusRaw === "number"
        ? EGRESS_STATUS[statusRaw] ?? String(statusRaw)
        : "unknown";

  const type = str(info, "type") ?? "egress";
  const role = recordingRoleFromOutput(output, type);
  return {
    id,
    type,
    status,
    startedAt: protoIso(started),
    endedAt: protoIso(ended),
    output,
    playableUrl: playableMediaUrl(output),
    error: str(info, "error"),
    durationSeconds: duration,
    role,
    label: recordingRoleLabel(role),
  };
}

export function recordingsFromWebhooks(payloads: unknown[]): SessionRecording[] {
  const byId = new Map<string, SessionRecording>();
  for (const payload of payloads) {
    const recording = recordingFromJson(payload);
    if (!recording) continue;
    const existing = byId.get(recording.id);
    if (!existing || (recording.output && !existing.output) || recording.status === "complete") {
      byId.set(recording.id, { ...existing, ...recording });
    }
  }
  return [...byId.values()];
}

export function recordingsFromEgressInfo(jobs: EgressInfo[]): SessionRecording[] {
  return jobs.map((job) => {
    const snapshot = toEgressSnapshot(job);
    const file = job.fileResults?.[0];
    const duration = protoSeconds(file?.duration != null ? Number(file.duration) : null);
    const role = recordingRoleFromOutput(snapshot.output, snapshot.type);
    return {
      id: snapshot.id,
      type: snapshot.type,
      status: snapshot.status,
      startedAt: snapshot.startedAt,
      endedAt: snapshot.endedAt,
      output: snapshot.output,
      playableUrl: playableMediaUrl(snapshot.output),
      error: snapshot.error,
      durationSeconds: duration,
      role,
      label: recordingRoleLabel(role),
    };
  });
}

export function mergeRecordings(...groups: SessionRecording[][]) {
  const byId = new Map<string, SessionRecording>();
  for (const group of groups) {
    for (const recording of group) {
      const existing = byId.get(recording.id);
      byId.set(recording.id, existing ? { ...existing, ...recording } : recording);
    }
  }
  // Mixed first so the player opens on the file that has both voices.
  return [...byId.values()].sort((a, b) => {
    const byRole = RECORDING_ROLE_ORDER[a.role] - RECORDING_ROLE_ORDER[b.role];
    if (byRole !== 0) return byRole;
    const aStart = a.startedAt ? Date.parse(a.startedAt) : 0;
    const bStart = b.startedAt ? Date.parse(b.startedAt) : 0;
    return bStart - aStart || a.id.localeCompare(b.id);
  });
}
