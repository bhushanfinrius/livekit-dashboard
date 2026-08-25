import { jsonError, jsonOk } from "@/lib/http";
import {
  liveKitActionError,
  readJsonBody,
  requireProjectLiveKit,
} from "@/lib/api/project";
import { toParticipantSnapshot } from "@/lib/livekit";
import {
  identitySchema,
  muteTrackSchema,
  roomNameSchema,
  trackSidSchema,
} from "@/lib/validators/rooms";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; room: string; identity: string; trackSid: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id, room, identity, trackSid } = await context.params;
  const parsedRoom = roomNameSchema.safeParse(room);
  const parsedIdentity = identitySchema.safeParse(identity);
  const parsedTrack = trackSidSchema.safeParse(trackSid);
  if (!parsedRoom.success || !parsedIdentity.success || !parsedTrack.success) {
    return jsonError("Invalid room, participant, or track", 400, "VALIDATION");
  }

  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const parsed = muteTrackSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError("muted must be a boolean", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    await access.livekit.rooms.muteTrack(
      parsedRoom.data,
      parsedIdentity.data,
      parsedTrack.data,
      parsed.data.muted,
    );
    const participants = await access.livekit.rooms.listParticipants(parsedRoom.data);
    const participant = participants
      .map(toParticipantSnapshot)
      .find((item) => item.identity === parsedIdentity.data);
    return jsonOk({ ok: true, participant: participant ?? null });
  } catch (error) {
    return liveKitActionError(error);
  }
}
