import { prisma } from "@/lib/db";
import { parseParticipantMeta } from "@/lib/overview/payload";
import { rangeWindow } from "@/lib/overview/series";
import type { OverviewRange } from "@/lib/overview/types";
import { reconstructSipCalls, toSipCallsPayload } from "@/lib/telephony/reconstruct";
import type { SipCallsPayload } from "@/lib/telephony/types";

const MAX_EVENTS = 50_000;

export async function loadSipCalls(
  projectId: string,
  range: OverviewRange,
): Promise<SipCallsPayload> {
  const now = Date.now();
  const { queryStart } = rangeWindow(range, now);
  const rows = await prisma.webhookEvent.findMany({
    where: {
      projectId,
      createdAt: { gte: new Date(queryStart) },
      eventType: {
        in: ["participant_joined", "participant_left", "participant_connection_aborted"],
      },
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
  });

  const calls = reconstructSipCalls(
    rows.map((row) => {
      const meta = parseParticipantMeta(row.rawPayload);
      return {
        id: row.id,
        eventType: row.eventType,
        roomName: row.roomName,
        identity: row.participantIdentity ?? meta.identity,
        kind: meta.kind,
        at: row.createdAt.getTime(),
        phone: meta.sip.phone,
        trunkNumber: meta.sip.trunkNumber,
        direction: meta.sip.direction,
      };
    }),
    now,
  );

  return toSipCallsPayload(calls, range, now);
}
