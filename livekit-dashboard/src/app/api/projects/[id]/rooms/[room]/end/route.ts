import { jsonError, jsonOk } from "@/lib/http";
import { liveKitActionError, requireProjectLiveKit } from "@/lib/api/project";
import { roomNameSchema } from "@/lib/validators/rooms";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; room: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id, room } = await context.params;
  const parsedRoom = roomNameSchema.safeParse(room);
  if (!parsedRoom.success) {
    return jsonError("Invalid room name", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    await access.livekit.rooms.end(parsedRoom.data);
    return jsonOk({ ok: true });
  } catch (error) {
    return liveKitActionError(error);
  }
}
