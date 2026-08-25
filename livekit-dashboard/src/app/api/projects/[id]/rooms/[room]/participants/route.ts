import { jsonError, jsonOk } from "@/lib/http";
import { liveKitActionError, requireProjectLiveKit } from "@/lib/api/project";
import { toParticipantSnapshot } from "@/lib/livekit";
import { roomNameSchema } from "@/lib/validators/rooms";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; room: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id, room } = await context.params;
  const parsedRoom = roomNameSchema.safeParse(room);
  if (!parsedRoom.success) {
    return jsonError("Invalid room name", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    const participants = await access.livekit.rooms.listParticipants(parsedRoom.data);
    return jsonOk({
      room: parsedRoom.data,
      participants: participants.map(toParticipantSnapshot),
    });
  } catch (error) {
    return liveKitActionError(error);
  }
}
