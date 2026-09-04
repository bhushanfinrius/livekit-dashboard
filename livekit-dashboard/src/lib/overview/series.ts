import { canonicalParticipantKey, kindFromIdentity, kindLabel, type KindBucket } from "@/lib/overview/payload";
import type { ChartPoint, KindSlice, OverviewRange, RankedItem } from "@/lib/overview/types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export type SeriesEvent = {
  eventType: string;
  roomName: string | null;
  participantIdentity: string | null;
  kind: KindBucket;
  infra?: boolean;
  region: string | null;
  sipDirection: "inbound" | "outbound" | null;
  at: number;
};

type Interval = {
  start: number;
  end: number;
  kind: KindBucket;
  sipDirection: "inbound" | "outbound" | null;
};

export function rangeWindow(range: OverviewRange, now = Date.now()) {
  const duration = range === "24h" ? DAY : range === "7d" ? 7 * DAY : 30 * DAY;
  const step = range === "24h" ? HOUR : range === "7d" ? 4 * HOUR : DAY;
  return {
    start: now - duration,
    end: now,
    step,
    queryStart: now - duration * 2,
  };
}

export function labelFor(timestamp: number, range: OverviewRange) {
  const date = new Date(timestamp);
  if (range === "24h") {
    return date.toLocaleTimeString(undefined, { hour: "numeric" });
  }
  if (range === "7d") {
    return date.toLocaleString(undefined, { weekday: "short", hour: "numeric" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function clip(interval: Interval, rangeStart: number, rangeEnd: number) {
  const start = Math.max(interval.start, rangeStart);
  const end = Math.min(interval.end, rangeEnd);
  return end > start ? { ...interval, start, end } : null;
}

const LIVE_OPEN_GRACE_MS = 120_000;

function seriesKind(event: SeriesEvent): KindBucket {
  const fromId = kindFromIdentity(event.participantIdentity);
  if (fromId === "sip" || fromId === "agent") return fromId;
  return event.kind;
}

function participantEventKey(roomName: string, identity: string) {
  return `${roomName}::${canonicalParticipantKey(identity)}`;
}

function closeOpenForRoom(
  open: Map<string, { at: number; kind: KindBucket; sipDirection: "inbound" | "outbound" | null; roomName: string }[]>,
  roomName: string,
  at: number,
  intervals: Interval[],
) {
  const prefix = `${roomName}::`;
  for (const [key, stack] of open) {
    if (!key.startsWith(prefix)) continue;
    while (stack.length > 0) {
      const started = stack.pop()!;
      if (at > started.at) {
        intervals.push({
          start: started.at,
          end: at,
          kind: started.kind,
          sipDirection: started.sipDirection,
        });
      }
    }
  }
}

function pairParticipantIntervals(events: SeriesEvent[], fallbackStart: number, openEnd: number) {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const open = new Map<
    string,
    { at: number; kind: KindBucket; sipDirection: "inbound" | "outbound" | null; roomName: string }[]
  >();
  const intervals: Interval[] = [];
  const lastAtByRoom = new Map<string, number>();
  const startTypes = new Set(["participant_joined"]);
  const endTypes = new Set(["participant_left", "participant_connection_aborted"]);

  for (const event of sorted) {
    if (event.roomName) {
      lastAtByRoom.set(event.roomName, Math.max(lastAtByRoom.get(event.roomName) ?? 0, event.at));
    }

    if (event.eventType === "room_finished" && event.roomName) {
      closeOpenForRoom(open, event.roomName, event.at, intervals);
      continue;
    }

    if (event.infra || kindFromIdentity(event.participantIdentity) === "infra") continue;
    if (!event.roomName || !event.participantIdentity) continue;
    const key = participantEventKey(event.roomName, event.participantIdentity);
    const kind = seriesKind(event);

    if (startTypes.has(event.eventType)) {
      const stack = open.get(key) ?? [];
      stack.push({
        at: event.at,
        kind,
        sipDirection: event.sipDirection,
        roomName: event.roomName,
      });
      open.set(key, stack);
      continue;
    }

    if (!endTypes.has(event.eventType)) continue;
    const stack = open.get(key) ?? [];
    const started = stack.pop() ?? {
      at: fallbackStart,
      kind,
      sipDirection: event.sipDirection,
      roomName: event.roomName,
    };
    intervals.push({
      start: started.at,
      end: event.at,
      kind: started.kind,
      sipDirection: started.sipDirection,
    });
    open.set(key, stack);
  }

  for (const stack of open.values()) {
    for (const started of stack) {
      const lastAt = lastAtByRoom.get(started.roomName) ?? started.at;
      const stale = openEnd - lastAt > LIVE_OPEN_GRACE_MS;
      const end = stale ? Math.max(started.at, lastAt) : openEnd;
      if (end > started.at) {
        intervals.push({
          start: started.at,
          end,
          kind: started.kind,
          sipDirection: started.sipDirection,
        });
      }
    }
  }

  return intervals;
}

function buckets(
  intervals: Interval[],
  rangeStart: number,
  rangeEnd: number,
  step: number,
  range: OverviewRange,
  mode: "minutes" | "count",
): ChartPoint[] {
  const points: ChartPoint[] = [];
  for (let t = rangeStart; t < rangeEnd; t += step) {
    const bucketEnd = Math.min(t + step, rangeEnd);
    let value = 0;
    if (mode === "minutes") {
      let ms = 0;
      for (const interval of intervals) {
        const overlap = Math.min(interval.end, bucketEnd) - Math.max(interval.start, t);
        if (overlap > 0) ms += overlap;
      }
      value = Math.round((ms / 60000) * 10) / 10;
    } else {
      const mid = t + (bucketEnd - t) / 2;
      for (const interval of intervals) {
        if (interval.start <= mid && interval.end > mid) value += 1;
      }
    }
    points.push({ date: labelFor(t, range), value });
  }
  return points;
}

function connectionSuccessSeries(
  events: SeriesEvent[],
  rangeStart: number,
  rangeEnd: number,
  step: number,
  range: OverviewRange,
) {
  const points: ChartPoint[] = [];
  let joins = 0;
  let aborted = 0;

  for (let t = rangeStart; t < rangeEnd; t += step) {
    const bucketEnd = Math.min(t + step, rangeEnd);
    let bucketJoins = 0;
    let bucketAborted = 0;
    for (const event of events) {
      if (event.infra || event.at < t || event.at >= bucketEnd) continue;
      if (event.eventType === "participant_joined") bucketJoins += 1;
      if (event.eventType === "participant_connection_aborted") bucketAborted += 1;
    }
    joins += bucketJoins;
    aborted += bucketAborted;
    const attempts = bucketJoins + bucketAborted;
    points.push({
      date: labelFor(t, range),
      value: attempts === 0 ? 0 : Math.round((100 * bucketJoins) / attempts),
    });
  }

  const attempts = joins + aborted;
  return {
    series: points,
    pct: attempts === 0 ? null : Math.round((100 * joins) / attempts),
  };
}

export function minutesForKind(slices: KindSlice[], prefix: string) {
  return slices.find((slice) => slice.name.startsWith(prefix))?.minutes ?? 0;
}

function minutesByKind(intervals: Interval[]): KindSlice[] {
  const totals: Record<KindBucket, number> = { webrtc: 0, sip: 0, agent: 0 };
  for (const interval of intervals) {
    totals[interval.kind] += (interval.end - interval.start) / 60000;
  }
  return (Object.keys(totals) as KindBucket[]).map((kind) => ({
    name: kindLabel(kind),
    minutes: Math.round(totals[kind] * 10) / 10,
  }));
}

function topRegions(events: SeriesEvent[]): RankedItem[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.infra || event.eventType !== "participant_joined") continue;
    const name = event.region?.trim();
    if (!name || name.toLowerCase() === "unknown") continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

export function buildOverviewSeries(events: SeriesEvent[], range: OverviewRange, now = Date.now()) {
  const { start, end, step } = rangeWindow(range, now);

  const participantIntervals = pairParticipantIntervals(events, start, end)
    .map((interval) => clip(interval, start, end))
    .filter((interval): interval is Interval => interval !== null);

  const success = connectionSuccessSeries(events, start, end, step, range);
  const kindSlices = minutesByKind(participantIntervals);
  const totalMinutes = kindSlices.reduce((sum, slice) => sum + slice.minutes, 0);

  const sipIntervals = participantIntervals.filter((interval) => interval.kind === "sip");
  const agentIntervals = participantIntervals.filter((interval) => interval.kind === "agent");
  const inboundSip = sipIntervals.filter((interval) => interval.sipDirection === "inbound");
  const outboundSip = sipIntervals.filter((interval) => interval.sipDirection === "outbound");
  const hasDirection = inboundSip.length > 0 || outboundSip.length > 0;

  function sipJoinsSeries() {
    const points: ChartPoint[] = [];
    for (let t = start; t < end; t += step) {
      const bucketEnd = Math.min(t + step, end);
      let value = 0;
      for (const event of events) {
        if (event.infra || event.eventType !== "participant_joined" || seriesKind(event) !== "sip") continue;
        if (event.at >= t && event.at < bucketEnd) value += 1;
      }
      points.push({ date: labelFor(t, range), value });
    }
    return points;
  }

  return {
    connectionSuccessPct: success.pct,
    connectionSuccess: success.series,
    participantMinutesTotal: Math.round(totalMinutes * 10) / 10,
    minutesByKind: kindSlices,
    participantCounts: buckets(participantIntervals, start, end, step, range, "count"),
    topRegions: topRegions(events),
    agentConcurrent: buckets(agentIntervals, start, end, step, range, "count"),
    sipJoins: sipJoinsSeries(),
    sipInboundMinutes: buckets(inboundSip, start, end, step, range, "minutes"),
    sipOutboundMinutes: buckets(outboundSip, start, end, step, range, "minutes"),
    sipMinutesSeries: buckets(sipIntervals, start, end, step, range, "minutes"),
    hasSipDirection: hasDirection,
  };
}

export function minutesFromSessions(
  sessions: { endedAt: string | null; participants: { kind: KindBucket; joinedAt: string; leftAt: string | null }[] }[],
  rangeStart: number,
  rangeEnd: number,
) {
  const byKind: Record<KindBucket, number> = { webrtc: 0, sip: 0, agent: 0 };
  let total = 0;
  for (const session of sessions) {
    const sessionEnd = session.endedAt ? Date.parse(session.endedAt) : rangeEnd;
    for (const participant of session.participants) {
      const start = Math.max(Date.parse(participant.joinedAt), rangeStart);
      const end = Math.min(participant.leftAt ? Date.parse(participant.leftAt) : sessionEnd, rangeEnd);
      if (end <= start) continue;
      const minutes = (end - start) / 60_000;
      total += minutes;
      byKind[participant.kind] += minutes;
    }
  }
  return {
    total: Math.round(total * 10) / 10,
    byKind: {
      webrtc: Math.round(byKind.webrtc * 10) / 10,
      sip: Math.round(byKind.sip * 10) / 10,
      agent: Math.round(byKind.agent * 10) / 10,
    },
  };
}
