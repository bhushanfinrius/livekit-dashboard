import type { KindBucket } from "@/lib/overview/payload";
import type { ChartPoint, OverviewRange } from "@/lib/overview/types";
import type { LiveWebhookEvent } from "@/lib/events/types";

export type SessionFeature = "agent" | "sip" | "egress";

export type SessionParticipant = {
  identity: string;
  kind: KindBucket;
  joinedAt: string;
  leftAt: string | null;
};

export type SessionSnapshot = {
  id: string;
  roomName: string;
  roomSid: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  status: "live" | "ended";
  peakParticipants: number;
  participantCount: number;
  implicit: boolean;
  features: SessionFeature[];
  participants: SessionParticipant[];
};

export type SessionsPayload = {
  range: OverviewRange;
  sessions: SessionSnapshot[];
  uniqueParticipants: number;
  uniqueParticipantSeries: ChartPoint[];
  roomCountSeries: ChartPoint[];
};

export type TranscriptSpeaker = "user" | "agent" | "system";

export type SessionTranscriptLine = {
  id: string;
  speaker: TranscriptSpeaker;
  identity: string | null;
  text: string;
  offsetMs: number;
  at: string | null;
};

/** mixed = both voices in one file, prospect/agent = single-side track. */
export type RecordingRole = "mixed" | "prospect" | "agent";

export type SessionRecording = {
  id: string;
  type: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  output: string | null;
  playableUrl: string | null;
  error: string | null;
  durationSeconds: number | null;
  role: RecordingRole;
  label: string;
};

export type SessionDetailPayload = {
  session: SessionSnapshot;
  events: LiveWebhookEvent[];
  timeline: ChartPoint[];
  webrtcMinutes: number;
  transcripts: SessionTranscriptLine[];
  recordings: SessionRecording[];
};

export type SessionEvent = {
  id: string;
  eventType: string;
  roomName: string | null;
  roomSid: string | null;
  participantIdentity: string | null;
  kind: KindBucket;
  at: number;
};

export const SESSION_EVENT_TYPES = [
  "room_started",
  "room_finished",
  "participant_joined",
  "participant_left",
  "participant_connection_aborted",
] as const;

export function sessionDisplayId(session: SessionSnapshot) {
  const sid = session.roomSid?.trim();
  if (sid) return sid;
  if (session.id.startsWith("implicit:") || session.id.startsWith("egress:")) return session.roomName;
  return session.id;
}

export function findSessionSnapshot(
  sessions: SessionSnapshot[],
  sessionId: string,
): SessionSnapshot | undefined {
  return sessions.find(
    (item) =>
      item.id === sessionId ||
      item.roomSid === sessionId ||
      item.roomName === sessionId ||
      sessionDisplayId(item) === sessionId,
  );
}

export function sessionLookupKeys(session: SessionSnapshot, sessionId?: string): string[] {
  return Array.from(
    new Set(
      [session.roomName, session.roomSid, session.id, sessionId]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}
