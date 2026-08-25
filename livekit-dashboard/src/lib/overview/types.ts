export const OVERVIEW_RANGES = ["24h", "7d", "30d"] as const;

export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

export const OVERVIEW_RANGE_LABELS: Record<OverviewRange, string> = {
  "24h": "Past 24 hours",
  "7d": "Past 7 days",
  "30d": "Past 30 days",
};

export type ChartPoint = {
  date: string;
  value: number;
};

export type KindSlice = {
  name: string;
  minutes: number;
};

export type RankedItem = {
  name: string;
  count: number;
};

export type OverviewLive = {
  reachable: boolean;
  error: string | null;
  activeRooms: number;
  participants: number;
  activeEgress: number;
  eventsLastHour: number;
};

export type OverviewPayload = {
  live: OverviewLive;
  range: OverviewRange;
  connectionSuccessPct: number | null;
  connectionSuccess: ChartPoint[];
  participantMinutesTotal: number;
  minutesByKind: KindSlice[];
  participantCounts: ChartPoint[];
  topRegions: RankedItem[];
  rooms: {
    totalSessions: number;
    averageSize: number;
    averageDurationSeconds: number;
    sessionCounts: ChartPoint[];
  };
  agents: {
    minutes: number;
    concurrent: ChartPoint[];
  };
  telephony: {
    minutes: number;
    sipSessions: number;
    sipJoins: ChartPoint[];
    minutesSeries: ChartPoint[];
    inboundMinutes: ChartPoint[];
    outboundMinutes: ChartPoint[];
    hasDirection: boolean;
  };
  recentEvents: import("@/lib/events/types").LiveWebhookEvent[];
};

export const CHART_EVENT_TYPES = [
  "room_started",
  "room_finished",
  "participant_joined",
  "participant_left",
  "participant_connection_aborted",
] as const;

export function isOverviewRange(value: string): value is OverviewRange {
  return (OVERVIEW_RANGES as readonly string[]).includes(value);
}
