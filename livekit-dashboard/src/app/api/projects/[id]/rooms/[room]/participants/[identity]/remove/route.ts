import { jsonError, jsonOk } from "@/lib/http";
import { liveKitActionError, requireProjectLiveKit } from "@/lib/api/project";
import { identitySchema, roomNameSchema } from "@/lib/validators/rooms";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; room: string; identity: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id, room, identity } = await context.params;
  const parsedRoom = roomNameSchema.safeParse(room);
  const parsedIdentity = identitySchema.safeParse(identity);
  if (!parsedRoom.success || !parsedIdentity.success) {
    return jsonError("Invalid room or participant", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    await access.livekit.rooms.removeParticipant(parsedRoom.data, parsedIdentity.data);
    return jsonOk({ ok: true });
  } catch (error) {
    return liveKitActionError(error);
  }
}
