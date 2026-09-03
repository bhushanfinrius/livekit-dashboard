import type { KindBucket } from "@/lib/overview/payload";
import type { SessionEvent, SessionFeature, SessionParticipant, SessionSnapshot } from "@/lib/sessions/types";

const JOIN = "participant_joined";
const LEAVE = new Set(["participant_left", "participant_connection_aborted"]);

type DraftParticipant = {
  identity: string;
  kind: KindBucket;
  joinedAt: number;
  leftAt: number | null;
};

type Draft = {
  id: string;
  roomName: string;
  roomSid: string | null;
  startedAt: number;
  endedAt: number | null;
  implicit: boolean;
  peak: number;
  present: Set<string>;
  participants: Map<string, DraftParticipant>;
};

function toIso(at: number) {
  return new Date(at).toISOString();
}

function snapshot(draft: Draft, now: number, egressRooms: Set<string>): SessionSnapshot {
  const endedAt = draft.endedAt;
  const end = endedAt ?? now;
  const participants: SessionParticipant[] = [...draft.participants.values()]
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((participant) => ({
      identity: participant.identity,
      kind: participant.kind,
      joinedAt: toIso(participant.joinedAt),
      leftAt: participant.leftAt ? toIso(participant.leftAt) : endedAt ? toIso(endedAt) : null,
    }));

  const features: SessionSnapshot["features"] = [];
  if (participants.some((participant) => participant.kind === "sip")) features.push("sip");
  if (participants.some((participant) => participant.kind === "agent")) features.push("agent");
  if (egressRooms.has(draft.roomName)) features.push("egress");

  return {
    id: draft.id,
    roomName: draft.roomName,
    roomSid: draft.roomSid,
    startedAt: toIso(draft.startedAt),
    endedAt: endedAt ? toIso(endedAt) : null,
    durationSeconds: Math.max(0, Math.round((end - draft.startedAt) / 1000)),
    status: endedAt ? "ended" : "live",
    peakParticipants: draft.peak,
    participantCount: participants.length,
    implicit: draft.implicit,
    features,
    participants,
  };
}

function createDraft(
  id: string,
  roomName: string,
  at: number,
  implicit: boolean,
  roomSid: string | null,
): Draft {
  return {
    id,
    roomName,
    roomSid,
    startedAt: at,
    endedAt: null,
    implicit,
    peak: 0,
    present: new Set(),
    participants: new Map(),
  };
}

function stackFor(byName: Map<string, Draft[]>, roomName: string) {
  const stack = byName.get(roomName) ?? [];
  byName.set(roomName, stack);
  return stack;
}

function findOpen(
  bySid: Map<string, Draft>,
  byName: Map<string, Draft[]>,
  roomSid: string | null,
  roomName: string | null,
) {
  if (roomSid) {
    const byId = bySid.get(roomSid);
    if (byId && byId.endedAt === null) return byId;
  }
  if (!roomName) return undefined;
  const stack = byName.get(roomName);
  if (!stack) return undefined;
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].endedAt === null) return stack[index];
  }
  return undefined;
}

function detach(bySid: Map<string, Draft>, byName: Map<string, Draft[]>, draft: Draft) {
  if (draft.roomSid) bySid.delete(draft.roomSid);
  const stack = byName.get(draft.roomName);
  if (!stack) return;
  const next = stack.filter((item) => item.id !== draft.id);
  if (next.length === 0) byName.delete(draft.roomName);
  else byName.set(draft.roomName, next);
}

function closeDraft(draft: Draft, at: number) {
  draft.endedAt = at;
  for (const participant of draft.participants.values()) {
    if (participant.leftAt === null) participant.leftAt = at;
  }
  draft.present.clear();
}

function markJoin(draft: Draft, identity: string, kind: KindBucket, at: number) {
  const existing = draft.participants.get(identity);
  if (!existing) {
    draft.participants.set(identity, { identity, kind, joinedAt: at, leftAt: null });
  } else if (existing.leftAt !== null) {
    existing.leftAt = null;
  }

  if (!draft.present.has(identity)) {
    draft.present.add(identity);
    draft.peak = Math.max(draft.peak, draft.present.size);
  }
}

function markLeave(draft: Draft, identity: string, at: number) {
  const existing = draft.participants.get(identity);
  if (existing && existing.leftAt === null) existing.leftAt = at;
  draft.present.delete(identity);
}

export function reconstructSessions(
  events: SessionEvent[],
  now = Date.now(),
  egressRooms: Set<string> = new Set(),
): SessionSnapshot[] {
  const sorted = [...events].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const bySid = new Map<string, Draft>();
  const byName = new Map<string, Draft[]>();
  const closed: Draft[] = [];

  function ensureOpen(event: SessionEvent): Draft | undefined {
    const roomName = event.roomName;
    if (!roomName) return undefined;
    const existing = findOpen(bySid, byName, event.roomSid, roomName);
    if (existing) return existing;

    const draft = createDraft(`implicit:${event.id}`, roomName, event.at, true, event.roomSid);
    stackFor(byName, roomName).push(draft);
    if (event.roomSid) bySid.set(event.roomSid, draft);
    return draft;
  }

  for (const event of sorted) {
    const roomName = event.roomName;
    if (event.eventType === "room_started") {
      if (!roomName) continue;
      const open = findOpen(bySid, byName, event.roomSid, roomName);
      if (open?.implicit) {
        open.implicit = false;
        open.id = event.id;
        open.startedAt = Math.min(open.startedAt, event.at);
        if (event.roomSid && !open.roomSid) {
          open.roomSid = event.roomSid;
          bySid.set(event.roomSid, open);
        }
        continue;
      }

      const draft = createDraft(event.id, roomName, event.at, false, event.roomSid);
      stackFor(byName, roomName).push(draft);
      if (event.roomSid) bySid.set(event.roomSid, draft);
      continue;
    }

    if (event.eventType === "room_finished") {
      if (!roomName && !event.roomSid) continue;
      const open = findOpen(bySid, byName, event.roomSid, roomName);
      if (!open) continue;
      closeDraft(open, event.at);
      detach(bySid, byName, open);
      closed.push(open);
      continue;
    }

    if (event.eventType === JOIN) {
      if (!event.participantIdentity) continue;
      const draft = ensureOpen(event);
      if (draft) markJoin(draft, event.participantIdentity, event.kind, event.at);
      continue;
    }

    if (!LEAVE.has(event.eventType) || !event.participantIdentity) continue;
    const draft = findOpen(bySid, byName, event.roomSid, roomName);
    if (draft) markLeave(draft, event.participantIdentity, event.at);
  }

  const live = [...byName.values()].flat().filter((draft) => draft.endedAt === null);
  return [...closed, ...live]
    .map((draft) => snapshot(draft, now, egressRooms))
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || a.id.localeCompare(b.id));
}

type EgressSessionSeed = {
  id: string;
  roomName: string;
  startedAt: string | null;
  endedAt: string | null;
  active: boolean;
  identities?: { identity: string; kind: KindBucket }[];
};

function collectIdentities(jobs: EgressSessionSeed[]): { identity: string; kind: KindBucket }[] {
  const seen = new Map<string, KindBucket>();
  for (const job of jobs) {
    for (const entry of job.identities ?? []) {
      if (!seen.has(entry.identity)) seen.set(entry.identity, entry.kind);
    }
  }
  return [...seen.entries()].map(([identity, kind]) => ({ identity, kind }));
}

function campaignFallbackIdentities(roomName: string): { identity: string; kind: KindBucket }[] {
  if (!/^(test|camp)-/i.test(roomName)) return [];
  return [
    { identity: "agent", kind: "agent" },
    { identity: "sip", kind: "sip" },
  ];
}

function participantsFromIdentities(
  identities: { identity: string; kind: KindBucket }[],
  startedAt: string,
  endedAt: string | null,
): SessionParticipant[] {
  return identities.map((entry) => ({
    identity: entry.identity,
    kind: entry.kind,
    joinedAt: startedAt,
    leftAt: endedAt,
  }));
}

function featuresFromParticipants(
  features: SessionFeature[],
  participants: SessionParticipant[],
): SessionFeature[] {
  const next = new Set(features);
  if (participants.some((participant) => participant.kind === "sip")) next.add("sip");
  if (participants.some((participant) => participant.kind === "agent")) next.add("agent");
  return [...next];
}

function enrichSession(
  session: SessionSnapshot,
  identities: { identity: string; kind: KindBucket }[],
): SessionSnapshot {
  const resolved =
    identities.length > 0 ? identities : campaignFallbackIdentities(session.roomName);
  const participants =
    session.participants.length > 0
      ? session.participants
      : resolved.length > 0
        ? participantsFromIdentities(resolved, session.startedAt, session.endedAt)
        : session.participants;
  const features = featuresFromParticipants(session.features, participants);
  const implicit = session.status === "ended" && features.includes("egress") ? false : session.implicit;
  return {
    ...session,
    participants,
    participantCount: Math.max(session.participantCount, participants.length),
    peakParticipants: Math.max(session.peakParticipants, participants.length),
    features,
    implicit,
  };
}

export function mergeEgressIntoSessions(
  sessions: SessionSnapshot[],
  jobs: EgressSessionSeed[],
  now = Date.now(),
): SessionSnapshot[] {
  const egressRooms = new Set(
    jobs.map((job) => job.roomName.trim()).filter(Boolean),
  );
  const withFeature: SessionSnapshot[] = sessions.map((session) =>
    egressRooms.has(session.roomName) && !session.features.includes("egress")
      ? { ...session, features: [...session.features, "egress"] satisfies SessionFeature[] }
      : session,
  );

  const byRoom = new Map<string, EgressSessionSeed[]>();
  for (const job of jobs) {
    const roomName = job.roomName.trim();
    if (!roomName) continue;
    const group = byRoom.get(roomName) ?? [];
    group.push(job);
    byRoom.set(roomName, group);
  }

  const extras: SessionSnapshot[] = [];
  for (const [roomName, group] of byRoom) {
    const started = Math.min(
      ...group.map((job) => (job.startedAt ? Date.parse(job.startedAt) : now)),
    );
    const live = group.some((job) => job.active);
    const ended = live
      ? null
      : Math.max(...group.map((job) => (job.endedAt ? Date.parse(job.endedAt) : started)));
    const rangeEnd = (ended ?? now) + 1;
    const overlaps = withFeature.some((session) =>
      session.roomName === roomName && sessionOverlapsRange(session, started, rangeEnd, now),
    );
    if (overlaps) continue;
    const startedAt = new Date(started).toISOString();
    const endedAt = ended ? new Date(ended).toISOString() : null;
    extras.push(
      enrichSession(
        {
          id: `egress:${roomName}:${started}`,
          roomName,
          roomSid: null,
          startedAt,
          endedAt,
          durationSeconds: Math.max(0, Math.round(((ended ?? now) - started) / 1000)),
          status: ended ? "ended" : "live",
          peakParticipants: 0,
          participantCount: 0,
          implicit: true,
          features: ["egress"] satisfies SessionFeature[],
          participants: [],
        },
        collectIdentities(group),
      ),
    );
  }

  const enriched = withFeature.map((session) =>
    enrichSession(session, collectIdentities(byRoom.get(session.roomName) ?? [])),
  );

  return [...enriched, ...extras].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || a.id.localeCompare(b.id),
  );
}

export function sessionOverlapsRange(
  session: SessionSnapshot,
  rangeStart: number,
  rangeEnd: number,
  now = Date.now(),
) {
  const start = Date.parse(session.startedAt);
  const end = session.endedAt ? Date.parse(session.endedAt) : now;
  return start < rangeEnd && end > rangeStart;
}
