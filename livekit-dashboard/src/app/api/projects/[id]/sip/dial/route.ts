import { jsonError, jsonOk } from "@/lib/http";
import {
  liveKitActionError,
  readJsonBody,
  requireProjectLiveKit,
} from "@/lib/api/project";
import { sipDialSchema } from "@/lib/validators/sip";
import { campaignConcurrencyError, ensureRoomWithAutoTrackEgress } from "@/lib/egress/recording";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const parsed = sipDialSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid dial request", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    const busy = await campaignConcurrencyError(access.livekit, parsed.data.roomName);
    if (busy) return jsonError(busy, 429, "BUSY");
    const roomResult = await ensureRoomWithAutoTrackEgress(access.livekit, parsed.data.roomName);
    if (roomResult.reason === "error" || roomResult.reason === "unconfigured") {
      console.error("[recording:auto-track]", parsed.data.roomName, roomResult.error ?? roomResult.reason);
    }
    const participant = await access.livekit.sip.dial(
      parsed.data.sipTrunkId,
      parsed.data.number,
      parsed.data.roomName,
      parsed.data.participantIdentity
        ? { participantIdentity: parsed.data.participantIdentity }
        : undefined,
    );
    return jsonOk({
      participantId: participant.participantId,
      participantIdentity: participant.participantIdentity,
      roomName: participant.roomName,
    });
  } catch (error) {
    return liveKitActionError(error);
  }
}
