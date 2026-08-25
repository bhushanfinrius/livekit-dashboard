import { rangeWindow } from "@/lib/overview/series";
import type { OverviewRange } from "@/lib/overview/types";
import type { SipCallDirection, SipCallSnapshot, SipCallsPayload } from "@/lib/telephony/types";

export type SipCallEvent = {
  id: string;
  eventType: string;
  roomName: string | null;
  identity: string | null;
  kind: "webrtc" | "sip" | "agent";
  at: number;
  phone: string | null;
  trunkNumber: string | null;
  direction: "inbound" | "outbound" | null;
};

const JOIN = "participant_joined";
const LEAVE = new Set(["participant_left", "participant_connection_aborted"]);

type OpenCall = {
  id: string;
  identity: string;
  roomName: string;
  startedAt: number;
  from: string | null;
  to: string | null;
  direction: SipCallDirection;
};

function toIso(at: number) {
  return new Date(at).toISOString();
}

function snapshot(call: OpenCall, endedAt: number | null, now: number): SipCallSnapshot {
  const end = endedAt ?? now;
  return {
    id: call.id,
    identity: call.identity,
    from: call.from,
    to: call.to,
    direction: call.direction,
    roomName: call.roomName,
    startedAt: toIso(call.startedAt),
    endedAt: endedAt ? toIso(endedAt) : null,
    durationSeconds: Math.max(0, Math.round((end - call.startedAt) / 1000)),
    status: endedAt ? "ended" : "live",
  };
}

export function reconstructSipCalls(events: SipCallEvent[], now = Date.now()): SipCallSnapshot[] {
  const sorted = [...events]
    .filter((event) => event.kind === "sip" && event.roomName && event.identity)
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

  const open = new Map<string, OpenCall[]>();
  const closed: SipCallSnapshot[] = [];

  for (const event of sorted) {
    const key = `${event.roomName}::${event.identity}`;
    if (event.eventType === JOIN) {
      const stack = open.get(key) ?? [];
      const direction: SipCallDirection = event.direction ?? "unknown";
      const from = direction === "outbound" ? event.trunkNumber ?? event.phone : event.phone;
      const to = direction === "outbound" ? event.phone : event.trunkNumber;
      stack.push({
        id: event.id,
        identity: event.identity!,
        roomName: event.roomName!,
        startedAt: event.at,
        from: from ?? event.identity,
        to: to ?? event.roomName,
        direction,
      });
      open.set(key, stack);
      continue;
    }

    if (!LEAVE.has(event.eventType)) continue;
    const stack = open.get(key) ?? [];
    const started = stack.pop();
    if (!started) continue;
    closed.push(snapshot(started, event.at, now));
    open.set(key, stack);
  }

  const live = [...open.values()].flat().map((call) => snapshot(call, null, now));
  return [...closed, ...live].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || a.id.localeCompare(b.id),
  );
}

export function toSipCallsPayload(
  calls: SipCallSnapshot[],
  range: OverviewRange,
  now = Date.now(),
): SipCallsPayload {
  const { start, end } = rangeWindow(range, now);
  const inRange = calls.filter((call) => {
    const started = Date.parse(call.startedAt);
    const finished = call.endedAt ? Date.parse(call.endedAt) : now;
    return started < end && finished > start;
  });
  const ended = inRange.filter((call) => call.status === "ended");
  const totalDurationSeconds = inRange.reduce((sum, call) => sum + call.durationSeconds, 0);
  return {
    range,
    calls: inRange.slice(0, 300),
    totalCalls: inRange.length,
    totalDurationSeconds,
    averageDurationSeconds:
      ended.length === 0
        ? 0
        : Math.round(ended.reduce((sum, call) => sum + call.durationSeconds, 0) / ended.length),
    liveCalls: inRange.filter((call) => call.status === "live").length,
  };
}
