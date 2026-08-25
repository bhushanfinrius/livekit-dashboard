import type { WebhookEvent } from "livekit-server-sdk";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { publishProjectEvent } from "@/lib/events/sse";
import {
  toLiveWebhookEvent,
  type EventLogPayload,
  type EventLogQuery,
  type EventLogRange,
} from "@/lib/events/types";

const EVENT_LIST_SELECT = {
  id: true,
  eventType: true,
  roomName: true,
  participantIdentity: true,
  egressId: true,
  ingressId: true,
  createdAt: true,
} as const;

export async function storeWebhookEvent(
  projectId: string,
  event: WebhookEvent,
  rawBody: string,
) {
  let rawPayload: Prisma.InputJsonValue;
  try {
    rawPayload = JSON.parse(rawBody) as Prisma.InputJsonValue;
  } catch {
    rawPayload = { raw: rawBody };
  }

  const room = event.room as { name?: string } | undefined;
  const participant = event.participant as { identity?: string } | undefined;
  const egress = event.egressInfo as { egressId?: string; roomName?: string } | undefined;
  const ingress = event.ingressInfo as { ingressId?: string } | undefined;

  const row = await prisma.webhookEvent.create({
    data: {
      projectId,
      eventType: event.event || "unknown",
      roomName: room?.name?.trim() || egress?.roomName?.trim() || null,
      participantIdentity: participant?.identity ?? null,
      egressId: egress?.egressId ?? null,
      ingressId: ingress?.ingressId ?? null,
      rawPayload,
    },
  });

  const dto = toLiveWebhookEvent(row);
  publishProjectEvent(projectId, dto);
  return dto;
}

export async function storeTranscriptEvent(
  projectId: string,
  input: {
    roomName: string;
    speaker: "user" | "agent" | "system";
    identity?: string | null;
    text: string;
    at?: string | null;
    offsetMs?: number;
  },
) {
  const at = input.at ?? new Date().toISOString();
  const identity = input.identity?.trim() || null;
  const payload = {
    event: "transcription",
    room: { name: input.roomName },
    ...(identity ? { participant: { identity } } : {}),
    transcription: {
      text: input.text,
      role: input.speaker,
      offsetMs: input.offsetMs ?? 0,
      startTime: input.offsetMs ?? 0,
      final: true,
      startedAt: at,
    },
  };

  const row = await prisma.webhookEvent.create({
    data: {
      projectId,
      eventType: "transcription",
      roomName: input.roomName,
      participantIdentity: identity,
      rawPayload: payload as Prisma.InputJsonValue,
    },
  });

  const dto = toLiveWebhookEvent(row);
  publishProjectEvent(projectId, dto);
  return dto;
}

function rangeStart(range: EventLogRange, now = Date.now()) {
  if (range === "all") return null;
  const day = 24 * 60 * 60 * 1000;
  const duration = range === "24h" ? day : range === "7d" ? 7 * day : 30 * day;
  return new Date(now - duration);
}

function eventWhere(
  projectId: string,
  query: Pick<EventLogQuery, "type" | "q" | "range">,
): Prisma.WebhookEventWhereInput {
  const needle = query.q?.trim();
  const since = rangeStart(query.range);
  const type = query.type?.trim();

  return {
    projectId,
    ...(type ? { eventType: type } : {}),
    ...(since ? { createdAt: { gte: since } } : {}),
    ...(needle
      ? {
          OR: [
            { eventType: { contains: needle, mode: "insensitive" } },
            { roomName: { contains: needle, mode: "insensitive" } },
            { participantIdentity: { contains: needle, mode: "insensitive" } },
            { egressId: { contains: needle, mode: "insensitive" } },
            { ingressId: { contains: needle, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export async function listWebhookEvents(
  projectId: string,
  query: EventLogQuery,
): Promise<EventLogPayload> {
  const where = eventWhere(projectId, query);
  const skip = (query.page - 1) * query.pageSize;

  const [rows, total, typeRows, lastAt] = await Promise.all([
    prisma.webhookEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: query.pageSize,
      select: EVENT_LIST_SELECT,
    }),
    prisma.webhookEvent.count({ where }),
    prisma.webhookEvent.findMany({
      where: { projectId },
      distinct: ["eventType"],
      select: { eventType: true },
      orderBy: { eventType: "asc" },
    }),
    getLastWebhookAt(projectId),
  ]);

  return {
    events: rows.map(toLiveWebhookEvent),
    total,
    page: query.page,
    pageSize: query.pageSize,
    lastAt: lastAt?.toISOString() ?? null,
    eventTypes: typeRows.map((row) => row.eventType).filter(Boolean),
  };
}

export async function getWebhookEvent(projectId: string, eventId: string) {
  return prisma.webhookEvent.findFirst({
    where: { id: eventId, projectId },
    select: {
      ...EVENT_LIST_SELECT,
      rawPayload: true,
    },
  });
}

export async function listRecentWebhookEvents(projectId: string, limit = 20) {
  const rows = await prisma.webhookEvent.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: EVENT_LIST_SELECT,
  });

  return rows.map(toLiveWebhookEvent);
}

export async function getLastWebhookAt(projectId: string) {
  const row = await prisma.webhookEvent.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}
