export type LiveWebhookEvent = {
  id: string;
  eventType: string;
  roomName: string | null;
  participantIdentity: string | null;
  egressId: string | null;
  ingressId: string | null;
  createdAt: string;
};

export type WebhookEventDetail = LiveWebhookEvent & {
  rawPayload: unknown;
};

export const EVENT_LOG_RANGES = ["24h", "7d", "30d", "all"] as const;
export type EventLogRange = (typeof EVENT_LOG_RANGES)[number];

export const EVENT_LOG_RANGE_LABELS: Record<EventLogRange, string> = {
  "24h": "Past 24 hours",
  "7d": "Past 7 days",
  "30d": "Past 30 days",
  all: "All time",
};

export const KNOWN_EVENT_TYPES = [
  "room_started",
  "room_finished",
  "participant_joined",
  "participant_left",
  "participant_connection_aborted",
  "track_published",
  "track_unpublished",
  "egress_started",
  "egress_updated",
  "egress_ended",
  "ingress_started",
  "ingress_ended",
] as const;

export type EventLogQuery = {
  type?: string;
  q?: string;
  range: EventLogRange;
  page: number;
  pageSize: number;
};

export type EventLogPayload = {
  events: LiveWebhookEvent[];
  total: number;
  page: number;
  pageSize: number;
  lastAt: string | null;
  eventTypes: string[];
};

export function isEventLogRange(value: string): value is EventLogRange {
  return (EVENT_LOG_RANGES as readonly string[]).includes(value);
}

export function eventMatchesQuery(event: LiveWebhookEvent, query: EventLogQuery, now = Date.now()) {
  if (query.type && event.eventType !== query.type) return false;

  const needle = query.q?.trim().toLowerCase();
  if (needle) {
    const haystack = [
      event.eventType,
      event.roomName,
      event.participantIdentity,
      event.egressId,
      event.ingressId,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  if (query.range !== "all") {
    const duration =
      query.range === "24h" ? 24 * 60 * 60 * 1000 : query.range === "7d" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    if (Date.parse(event.createdAt) < now - duration) return false;
  }

  return true;
}

export function toLiveWebhookEvent(row: {
  id: string;
  eventType: string;
  roomName: string | null;
  participantIdentity: string | null;
  egressId: string | null;
  ingressId: string | null;
  createdAt: Date;
}): LiveWebhookEvent {
  return {
    id: row.id,
    eventType: row.eventType,
    roomName: row.roomName,
    participantIdentity: row.participantIdentity,
    egressId: row.egressId,
    ingressId: row.ingressId,
    createdAt: row.createdAt.toISOString(),
  };
}
