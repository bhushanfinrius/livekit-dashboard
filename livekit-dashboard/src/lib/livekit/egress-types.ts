import type { KindBucket } from "@/lib/overview/payload";

export type EgressJobType =
  | "room composite"
  | "web"
  | "participant"
  | "track composite"
  | "track"
  | "replay"
  | "unknown";

export type EgressStatusLabel =
  | "starting"
  | "active"
  | "ending"
  | "complete"
  | "failed"
  | "aborted"
  | "limit reached"
  | "unknown";

export type EgressSnapshot = {
  id: string;
  roomName: string;
  type: EgressJobType;
  status: EgressStatusLabel;
  startedAt: string | null;
  endedAt: string | null;
  output: string | null;
  error: string | null;
  active: boolean;
  identities: { identity: string; kind: KindBucket }[];
};

export type IngressInputLabel = "RTMP" | "WHIP" | "URL" | "unknown";

export type IngressStateLabel =
  | "inactive"
  | "buffering"
  | "publishing"
  | "error"
  | "complete"
  | "unknown";

export type IngressSnapshot = {
  id: string;
  name: string;
  roomName: string;
  inputType: IngressInputLabel;
  state: IngressStateLabel;
  url: string;
  streamKey: string;
  participantIdentity: string;
  error: string | null;
};

export const EGRESS_LIVE_EVENTS = new Set([
  "egress_started",
  "egress_updated",
  "egress_ended",
  "ingress_started",
  "ingress_updated",
  "ingress_ended",
]);
