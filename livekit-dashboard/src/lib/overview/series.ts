import { kindLabel, type KindBucket } from "@/lib/overview/payload";
import type { ChartPoint, KindSlice, OverviewRange, RankedItem } from "@/lib/overview/types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export type SeriesEvent = {
  eventType: string;
  roomName: string | null;
  participantIdentity: string | null;
  kind: KindBucket;
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

function pairParticipantIntervals(events: SeriesEvent[], fallbackStart: number, openEnd: number) {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const open = new Map<
    string,
    { at: number; kind: KindBucket; sipDirection: "inbound" | "outbound" | null }[]
  >();
  const intervals: Interval[] = [];
  const startTypes = new Set(["participant_joined"]);
  const endTypes = new Set(["participant_left", "participant_connection_aborted"]);

  for (const event of sorted) {
    if (!event.roomName || !event.participantIdentity) continue;
    const key = `${event.roomName}::${event.participantIdentity}`;

    if (startTypes.has(event.eventType)) {
      const stack = open.get(key) ?? [];
      stack.push({ at: event.at, kind: event.kind, sipDirection: event.sipDirection });
      open.set(key, stack);
      continue;
    }

    if (!endTypes.has(event.eventType)) continue;
    const stack = open.get(key) ?? [];
    const started = stack.pop() ?? { at: fallbackStart, kind: event.kind, sipDirection: event.sipDirection };
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
      intervals.push({
        start: started.at,
        end: openEnd,
        kind: started.kind,
        sipDirection: started.sipDirection,
      });
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
      if (event.at < t || event.at >= bucketEnd) continue;
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
    if (event.eventType !== "participant_joined") continue;
    const name = event.region || "Unknown";
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
        if (event.eventType !== "participant_joined" || event.kind !== "sip") continue;
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
