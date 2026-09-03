import { prisma } from "@/lib/db";
import { listRecentWebhookEvents } from "@/lib/events/store";
import { liveKitErrorMessage, type ProjectLiveKit } from "@/lib/livekit";
import { kindLabel, parseParticipantMeta, parseRoomMeta } from "@/lib/overview/payload";
import { buildOverviewSeries, labelFor, minutesFromSessions, rangeWindow } from "@/lib/overview/series";
import {
  CHART_EVENT_TYPES,
  type ChartPoint,
  type OverviewLive,
  type OverviewPayload,
  type OverviewRange,
} from "@/lib/overview/types";
import { reconstructSessions, sessionOverlapsRange } from "@/lib/sessions/reconstruct";
import { loadSessions } from "@/lib/sessions/load";

export async function loadOverview(
  livekit: ProjectLiveKit,
  range: OverviewRange,
): Promise<OverviewPayload> {
  const projectId = livekit.projectId;
  const now = Date.now();
  const hourAgo = new Date(now - 60 * 60 * 1000);
  const { queryStart } = rangeWindow(range, now);

  const live: OverviewLive = {
    reachable: false,
    error: null,
    activeRooms: 0,
    participants: 0,
    activeEgress: 0,
    eventsLastHour: 0,
  };

  const [eventsLastHour, recentEvents, chartRows] = await Promise.all([
    prisma.webhookEvent.count({
      where: { projectId, createdAt: { gte: hourAgo } },
    }),
    listRecentWebhookEvents(projectId, 20),
    prisma.webhookEvent.findMany({
      where: {
        projectId,
        createdAt: { gte: new Date(queryStart) },
        eventType: { in: [...CHART_EVENT_TYPES] },
      },
      orderBy: { createdAt: "asc" },
      take: 50_000,
      select: {
        id: true,
        eventType: true,
        roomName: true,
        participantIdentity: true,
        createdAt: true,
        rawPayload: true,
      },
    }),
  ]);

  live.eventsLastHour = eventsLastHour;

  try {
    const [rooms, egress] = await Promise.all([
      livekit.rooms.list(),
      livekit.egress.list({ active: true }),
    ]);
    live.reachable = true;
    live.activeRooms = rooms.length;
    live.participants = rooms.reduce((sum, room) => sum + room.numParticipants, 0);
    live.activeEgress = egress.length;
  } catch (error) {
    live.error = liveKitErrorMessage(error);
  }

  const mapped = chartRows.map((row) => {
    const meta = parseParticipantMeta(row.rawPayload);
    const room = parseRoomMeta(row.rawPayload);
    return {
      series: {
        eventType: row.eventType,
        roomName: row.roomName,
        participantIdentity: row.participantIdentity,
        kind: meta.kind,
        region: meta.region,
        sipDirection: meta.sip.direction,
        at: row.createdAt.getTime(),
      },
      session: {
        id: row.id,
        eventType: row.eventType,
        roomName: row.roomName ?? room.name,
        roomSid: room.sid,
        participantIdentity: row.participantIdentity,
        kind: meta.kind,
        at: row.createdAt.getTime(),
      },
    };
  });

  const series = buildOverviewSeries(
    mapped.map((row) => row.series),
    range,
    now,
  );
  const { start, end, step } = rangeWindow(range, now);
  const reconstructed = reconstructSessions(mapped.map((row) => row.session), now).filter((session) =>
    sessionOverlapsRange(session, start, end, now),
  );
  const sessionPayload = await loadSessions(projectId, range);
  const sessions = sessionPayload.sessions.length > 0 ? sessionPayload.sessions : reconstructed;
  const sipSessions = sessions.filter((session) => session.features.includes("sip")).length;
  const averageSize =
    sessions.length === 0
      ? 0
      : sessions.reduce((sum, session) => sum + session.participantCount, 0) / sessions.length;
  const averageDurationSeconds =
    sessions.length === 0
      ? 0
      : sessions.reduce((sum, session) => sum + session.durationSeconds, 0) / sessions.length;

  const sessionCounts: ChartPoint[] =
    sessionPayload.roomCountSeries.length > 0
      ? sessionPayload.roomCountSeries
      : [];
  if (sessionCounts.length === 0) {
    for (let t = start; t < end; t += step) {
      const bucketEnd = Math.min(t + step, end);
      sessionCounts.push({
        date: labelFor(t, range),
        value: sessions.filter((session) => sessionOverlapsRange(session, t, bucketEnd, now)).length,
      });
    }
  }

  const fromSessions = minutesFromSessions(sessions, start, end);
  const agentMinutes =
    series.minutesByKind.find((slice) => slice.name.startsWith("Agent"))?.minutes || fromSessions.byKind.agent;
  const sipMinutes =
    series.minutesByKind.find((slice) => slice.name.startsWith("SIP"))?.minutes || fromSessions.byKind.sip;
  const participantMinutesTotal =
    series.participantMinutesTotal > 0 ? series.participantMinutesTotal : fromSessions.total;
  const webhookParticipantTotal = series.participantCounts.reduce((sum, point) => sum + point.value, 0);
  const participantCounts =
    webhookParticipantTotal > 0
      ? series.participantCounts
      : sessionPayload.uniqueParticipantSeries.length > 0
        ? sessionPayload.uniqueParticipantSeries
        : series.participantCounts;

  return {
    live,
    range,
    connectionSuccessPct: series.connectionSuccessPct,
    connectionSuccess: series.connectionSuccess,
    participantMinutesTotal,
    minutesByKind:
      series.participantMinutesTotal > 0
        ? series.minutesByKind
        : [
            { name: kindLabel("webrtc"), minutes: fromSessions.byKind.webrtc },
            { name: kindLabel("sip"), minutes: fromSessions.byKind.sip },
            { name: kindLabel("agent"), minutes: fromSessions.byKind.agent },
          ],
    participantCounts,
    topRegions: series.topRegions,
    rooms: {
      totalSessions: sessions.length,
      averageSize: Math.round(averageSize * 10) / 10,
      averageDurationSeconds: Math.round(averageDurationSeconds),
      sessionCounts,
    },
    agents: {
      minutes: agentMinutes,
      concurrent: series.agentConcurrent,
    },
    telephony: {
      minutes: sipMinutes,
      sipSessions,
      sipJoins: series.sipJoins,
      minutesSeries: series.sipMinutesSeries,
      inboundMinutes: series.sipInboundMinutes,
      outboundMinutes: series.sipOutboundMinutes,
      hasDirection: series.hasSipDirection,
    },
    recentEvents,
  };
}
