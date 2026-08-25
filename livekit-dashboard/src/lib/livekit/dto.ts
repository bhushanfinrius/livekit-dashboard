import type { ParticipantInfo, Room, TrackInfo } from "livekit-server-sdk";
import type {
  ParticipantSnapshot,
  RoomSnapshot,
  TrackKind,
  TrackSnapshot,
} from "@/lib/livekit/types";

function protoMillis(ms: bigint | number | undefined, seconds: bigint | number | undefined) {
  const milli = Number(ms ?? 0);
  if (milli > 0) return milli;
  return Number(seconds ?? 0) * 1000;
}

function protoIso(ms: bigint | number | undefined, seconds: bigint | number | undefined) {
  const millis = protoMillis(ms, seconds);
  return millis > 0 ? new Date(millis).toISOString() : new Date().toISOString();
}

const TRACK_TYPES: Record<number, TrackKind> = {
  0: "audio",
  1: "video",
  2: "data",
};

const TRACK_SOURCES: Record<number, string> = {
  0: "unknown",
  1: "camera",
  2: "microphone",
  3: "screen",
  4: "screen-audio",
};

const PARTICIPANT_STATES: Record<number, string> = {
  0: "joining",
  1: "joined",
  2: "active",
  3: "disconnected",
};

const PARTICIPANT_KINDS: Record<number, string> = {
  0: "standard",
  1: "ingress",
  2: "egress",
  3: "sip",
  4: "agent",
  7: "connector",
  8: "bridge",
};

function toTrackSnapshot(track: TrackInfo): TrackSnapshot {
  return {
    sid: track.sid,
    type: TRACK_TYPES[track.type] ?? "data",
    name: track.name,
    muted: track.muted,
    source: TRACK_SOURCES[track.source] ?? "unknown",
    mimeType: track.mimeType,
    width: track.width,
    height: track.height,
  };
}

export function toRoomSnapshot(room: Room): RoomSnapshot {
  return {
    sid: room.sid,
    name: room.name,
    numParticipants: room.numParticipants,
    numPublishers: room.numPublishers,
    maxParticipants: room.maxParticipants,
    metadata: room.metadata,
    createdAt: protoIso(room.creationTimeMs, room.creationTime),
    activeRecording: room.activeRecording,
  };
}

export function toParticipantSnapshot(participant: ParticipantInfo): ParticipantSnapshot {
  const media = (participant.tracks ?? []).map(toTrackSnapshot);
  const data = (participant.dataTracks ?? []).map(
    (track): TrackSnapshot => ({
      sid: track.sid,
      type: "data",
      name: track.name,
      muted: false,
      source: "data",
      mimeType: "",
      width: 0,
      height: 0,
    }),
  );

  return {
    sid: participant.sid,
    identity: participant.identity,
    name: participant.name,
    state: PARTICIPANT_STATES[participant.state] ?? "unknown",
    kind: PARTICIPANT_KINDS[participant.kind] ?? "standard",
    isPublisher: participant.isPublisher,
    region: participant.region,
    joinedAt: protoIso(participant.joinedAtMs, participant.joinedAt),
    metadata: participant.metadata,
    tracks: [...media, ...data],
  };
}
