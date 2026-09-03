import { prisma } from "@/lib/db";
import { toLiveWebhookEvent } from "@/lib/events/types";
import { getProjectLiveKitForWebhook, toEgressSnapshot, type ProjectLiveKit } from "@/lib/livekit";
import { asRecord, parseParticipantMeta, parseRoomMeta } from "@/lib/overview/payload";
import { labelFor, rangeWindow } from "@/lib/overview/series";
import type { ChartPoint, OverviewRange } from "@/lib/overview/types";
import { mergeRecordings, parseSessionTranscripts, recordingsFromEgressInfo, recordingsFromWebhooks } from "@/lib/sessions/insights";
import { identitiesFromRecordingOutputs } from "@/lib/sessions/recording-role";
import { resolvePlayableUrl } from "@/lib/gcs";
import { mergeEgressIntoSessions, reconstructSessions, sessionOverlapsRange } from "@/lib/sessions/reconstruct";
import {
  SESSION_EVENT_TYPES,
  findSessionSnapshot,
  sessionLookupKeys,
  type SessionDetailPayload,
  type SessionSnapshot,
  type SessionsPayload,
} from "@/lib/sessions/types";

const MAX_EVENTS = 50_000;
const MAX_SESSIONS = 200;

function toEvents(
  rows: {
    id: string;
    eventType: string;
    roomName: string | null;
    participantIdentity: string | null;
    createdAt: Date;
    rawPayload: unknown;
  }[],
) {
  return rows.map((row) => {
    const participant = parseParticipantMeta(row.rawPayload);
    const room = parseRoomMeta(row.rawPayload);
    return {
      id: row.id,
      eventType: row.eventType,
      roomName: row.roomName ?? room.name,
      roomSid: room.sid,
      participantIdentity: row.participantIdentity,
      kind: participant.kind,
      at: row.createdAt.getTime(),
    };
  });
}

function fileLocationsFromPayload(raw: unknown): { outputs: string[]; type: string | null } {
  const root = asRecord(raw);
  const info = asRecord(root?.egressInfo) ?? asRecord(root?.egress_info) ?? root;
  if (!info) return { outputs: [], type: null };
  const files = Array.isArray(info.fileResults)
    ? info.fileResults
    : Array.isArray(info.file_results)
      ? info.file_results
      : [];
  const outputs: string[] = [];
  for (const file of files) {
    const rec = asRecord(file);
    const location =
      (typeof rec?.location === "string" && rec.location.trim()) ||
      (typeof rec?.filename === "string" && rec.filename.trim()) ||
      "";
    if (location) outputs.push(location);
  }
  const type = typeof info.type === "string" ? info.type : null;
  return { outputs, type };
}

function webhookEgressSeeds(
  rows: { id?: string; roomName: string | null; createdAt?: Date; eventType?: string; rawPayload: unknown }[],
) {
  return rows.flatMap((row) => {
    const roomName = row.roomName ?? parseRoomMeta(row.rawPayload).name;
    if (!roomName) return [];
    const { outputs, type } = fileLocationsFromPayload(row.rawPayload);
    const root = asRecord(row.rawPayload);
    const info = asRecord(root?.egressInfo) ?? asRecord(root?.egress_info);
    const egressId =
      (typeof info?.egressId === "string" && info.egressId) ||
      (typeof info?.egress_id === "string" && info.egress_id) ||
      row.id ||
      roomName;
    const at = row.createdAt?.toISOString() ?? null;
    return [
      {
        id: egressId,
        roomName,
        startedAt: at,
        endedAt: row.eventType === "egress_ended" ? at : null,
        active: false,
        identities: identitiesFromRecordingOutputs(outputs, type),
      },
    ];
  });
}

function summarySeries(sessions: SessionSnapshot[], range: OverviewRange, now: number) {
  const { start, end, step } = rangeWindow(range, now);
  const uniqueParticipantSeries: ChartPoint[] = [];
  const roomCountSeries: ChartPoint[] = [];
  for (let t = start; t < end; t += step) {
    const bucketEnd = Math.min(t + step, end);
    const overlapping = sessions.filter((session) =>
      sessionOverlapsRange(session, t, bucketEnd, now),
    );
    const identities = new Set(
      overlapping.flatMap((session) => session.participants.map((participant) => participant.identity)),
    );
    uniqueParticipantSeries.push({ date: labelFor(t, range), value: identities.size });
    roomCountSeries.push({ date: labelFor(t, range), value: overlapping.length });
  }
  return { uniqueParticipantSeries, roomCountSeries };
}

export async function loadSessions(
  projectId: string,
  range: OverviewRange,
): Promise<SessionsPayload> {
  const now = Date.now();
  const { start, end, queryStart } = rangeWindow(range, now);

  const [rows, egressRows] = await Promise.all([
    prisma.webhookEvent.findMany({
      where: {
        projectId,
        createdAt: { gte: new Date(queryStart) },
        eventType: { in: [...SESSION_EVENT_TYPES] },
      },
      orderBy: { createdAt: "asc" },
      take: MAX_EVENTS,
      select: {
        id: true,
        eventType: true,
        roomName: true,
        participantIdentity: true,
        createdAt: true,
        rawPayload: true,
      },
    }),
    prisma.webhookEvent.findMany({
      where: {
        projectId,
        createdAt: { gte: new Date(queryStart) },
        eventType: { in: ["egress_started", "egress_updated", "egress_ended"] },
      },
      select: { id: true, eventType: true, roomName: true, createdAt: true, rawPayload: true },
    }),
  ]);

  const livekit = await getProjectLiveKitForWebhook(projectId);
  let liveJobs = [] as ReturnType<typeof toEgressSnapshot>[];
  if (livekit) {
    try {
      liveJobs = (await livekit.egress.list()).map(toEgressSnapshot);
    } catch {
      liveJobs = [];
    }
  }

  const egressRooms = new Set([
    ...egressRows
      .map((row) => row.roomName ?? parseRoomMeta(row.rawPayload).name)
      .filter((name): name is string => Boolean(name)),
    ...liveJobs.map((job) => job.roomName).filter(Boolean),
  ]);

  const reconstructed = reconstructSessions(toEvents(rows), now, egressRooms);
  const sessions = mergeEgressIntoSessions(
    reconstructed,
    [...liveJobs, ...webhookEgressSeeds(egressRows)],
    now,
  )
    .filter((session) => sessionOverlapsRange(session, start, end, now))
    .slice(0, MAX_SESSIONS);

  const uniqueParticipants = new Set(
    sessions.flatMap((session) => session.participants.map((participant) => participant.identity)),
  ).size;
  const series = summarySeries(sessions, range, now);

  return {
    range,
    sessions,
    uniqueParticipants,
    uniqueParticipantSeries: series.uniqueParticipantSeries,
    roomCountSeries: series.roomCountSeries,
  };
}

function sessionTimeline(session: SessionSnapshot, now: number): ChartPoint[] {
  const start = Date.parse(session.startedAt);
  const end = session.endedAt ? Date.parse(session.endedAt) : now;
  const span = Math.max(end - start, 1000);
  const step = Math.max(Math.floor(span / 24), 15_000);
  const points: ChartPoint[] = [];
  for (let t = start; t < end; t += step) {
    const mid = t + Math.min(step, end - t) / 2;
    let count = 0;
    for (const participant of session.participants) {
      const joined = Date.parse(participant.joinedAt);
      const left = participant.leftAt ? Date.parse(participant.leftAt) : end;
      if (joined <= mid && left > mid) count += 1;
    }
    points.push({
      date: new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
      value: count,
    });
  }
  return points;
}

function webrtcMinutes(session: SessionSnapshot, now: number) {
  const sessionEnd = session.endedAt ? Date.parse(session.endedAt) : now;
  let ms = 0;
  for (const participant of session.participants) {
    if (participant.kind !== "webrtc") continue;
    const start = Date.parse(participant.joinedAt);
    const end = participant.leftAt ? Date.parse(participant.leftAt) : sessionEnd;
    if (end > start) ms += end - start;
  }
  return Math.round((ms / 60000) * 10) / 10;
}

const SESSION_DETAIL_EVENT_SELECT = {
  id: true,
  eventType: true,
  roomName: true,
  participantIdentity: true,
  egressId: true,
  ingressId: true,
  createdAt: true,
  rawPayload: true,
} as const;

export async function loadSessionDetail(
  projectId: string,
  sessionId: string,
  livekit?: ProjectLiveKit | null,
): Promise<SessionDetailPayload | null> {
  const payload = await loadSessions(projectId, "30d");
  const session = findSessionSnapshot(payload.sessions, sessionId);
  if (!session) return null;

  const now = Date.now();
  const started = new Date(Date.parse(session.startedAt) - 1000);
  const ended = new Date((session.endedAt ? Date.parse(session.endedAt) : now) + 1000);
  const roomKeys = sessionLookupKeys(session, sessionId);

  const [eventRows, transcriptRows] = await Promise.all([
    prisma.webhookEvent.findMany({
      where: {
        projectId,
        createdAt: { gte: started, lte: ended },
        roomName: { in: roomKeys },
      },
      orderBy: { createdAt: "asc" },
      take: 400,
      select: SESSION_DETAIL_EVENT_SELECT,
    }),
    // Query transcriptions on their own. Mixing them with project-wide egress
    // rows and take:400 dropped live [deck-transcript] posts from Agent Insights.
    prisma.webhookEvent.findMany({
      where: {
        projectId,
        eventType: "transcription",
        roomName: { in: roomKeys },
      },
      orderBy: { createdAt: "asc" },
      take: 500,
      select: SESSION_DETAIL_EVENT_SELECT,
    }),
  ]);

  const byId = new Map<string, (typeof eventRows)[number]>();
  for (const row of [...eventRows, ...transcriptRows]) {
    byId.set(row.id, row);
  }
  const scopedRows = [...byId.values()]
    .filter((row) => {
      if (row.roomName && roomKeys.includes(row.roomName)) return true;
      const payloadRoom = parseRoomMeta(row.rawPayload).name;
      return Boolean(payloadRoom && roomKeys.includes(payloadRoom));
    })
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  let liveRecordings = [] as ReturnType<typeof recordingsFromEgressInfo>;
  const kit = livekit ?? (await getProjectLiveKitForWebhook(projectId));
  if (kit) {
    try {
      const jobs = await kit.egress.list();
      liveRecordings = recordingsFromEgressInfo(
        jobs.filter((job) => job.roomName === session.roomName),
      );
    } catch {
      liveRecordings = [];
    }
  }

  const agentIdentities = new Set(
    session.participants.filter((participant) => participant.kind === "agent").map((participant) => participant.identity),
  );

  const merged = mergeRecordings(recordingsFromWebhooks(scopedRows.map((row) => row.rawPayload)), liveRecordings);
  const recordings = await Promise.all(
    merged.map(async (recording) => {
      try {
        const signed = (await resolvePlayableUrl(recording.output)) ?? recording.playableUrl;
        return {
          ...recording,
          playableUrl: signed
            ? `/api/projects/${projectId}/recordings/stream?u=${encodeURIComponent(signed)}`
            : null,
        };
      } catch {
        return recording;
      }
    }),
  );

  return {
    session,
    events: scopedRows.map(toLiveWebhookEvent),
    timeline: sessionTimeline(session, now),
    webrtcMinutes: webrtcMinutes(session, now),
    transcripts: parseSessionTranscripts(
      scopedRows.map((row) => row.rawPayload),
      agentIdentities,
    ),
    recordings,
  };
}
