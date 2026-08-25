import { prisma } from "@/lib/db";
import { listRecentWebhookEvents } from "@/lib/events/store";
import { liveKitErrorMessage, type ProjectLiveKit } from "@/lib/livekit";
import { parseParticipantMeta, parseRoomMeta } from "@/lib/overview/payload";
import { buildOverviewSeries, labelFor, rangeWindow } from "@/lib/overview/series";
import {
  CHART_EVENT_TYPES,
  type ChartPoint,
  type OverviewLive,
  type OverviewPayload,
  type OverviewRange,
} from "@/lib/overview/types";
import { reconstructSessions, sessionOverlapsRange } from "@/lib/sessions/reconstruct";

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
  const sipSessions = reconstructed.filter((session) => session.features.includes("sip")).length;
  const averageSize =
    reconstructed.length === 0
      ? 0
      : reconstructed.reduce((sum, session) => sum + session.participantCount, 0) / reconstructed.length;
  const averageDurationSeconds =
    reconstructed.length === 0
      ? 0
      : reconstructed.reduce((sum, session) => sum + session.durationSeconds, 0) / reconstructed.length;

  const sessionCounts: ChartPoint[] = [];
  for (let t = start; t < end; t += step) {
    const bucketEnd = Math.min(t + step, end);
    sessionCounts.push({
      date: labelFor(t, range),
      value: reconstructed.filter((session) => sessionOverlapsRange(session, t, bucketEnd, now)).length,
    });
  }

  const agentMinutes =
    series.minutesByKind.find((slice) => slice.name.startsWith("Agent"))?.minutes ?? 0;
  const sipMinutes = series.minutesByKind.find((slice) => slice.name.startsWith("SIP"))?.minutes ?? 0;

  return {
    live,
    range,
    connectionSuccessPct: series.connectionSuccessPct,
    connectionSuccess: series.connectionSuccess,
    participantMinutesTotal: series.participantMinutesTotal,
    minutesByKind: series.minutesByKind,
    participantCounts: series.participantCounts,
    topRegions: series.topRegions,
    rooms: {
      totalSessions: reconstructed.length,
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
