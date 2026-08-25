export type SipCallDirection = "inbound" | "outbound" | "unknown";

export type SipCallSnapshot = {
  id: string;
  identity: string;
  from: string | null;
  to: string | null;
  direction: SipCallDirection;
  roomName: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  status: "live" | "ended";
};

export type SipCallsPayload = {
  range: import("@/lib/overview/types").OverviewRange;
  calls: SipCallSnapshot[];
  totalCalls: number;
  totalDurationSeconds: number;
  averageDurationSeconds: number;
  liveCalls: number;
};
