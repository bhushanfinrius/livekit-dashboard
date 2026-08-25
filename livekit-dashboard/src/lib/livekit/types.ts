export type RoomSnapshot = {
  sid: string;
  name: string;
  numParticipants: number;
  numPublishers: number;
  maxParticipants: number;
  metadata: string;
  createdAt: string;
  activeRecording: boolean;
};

export type TrackKind = "audio" | "video" | "data";

export type TrackSnapshot = {
  sid: string;
  type: TrackKind;
  name: string;
  muted: boolean;
  source: string;
  mimeType: string;
  width: number;
  height: number;
};

export type ParticipantSnapshot = {
  sid: string;
  identity: string;
  name: string;
  state: string;
  kind: string;
  isPublisher: boolean;
  region: string;
  joinedAt: string;
  metadata: string;
  tracks: TrackSnapshot[];
};

export const ROOM_LIVE_EVENTS = new Set([
  "room_started",
  "room_finished",
  "participant_joined",
  "participant_left",
  "participant_connection_aborted",
  "track_published",
  "track_unpublished",
]);
