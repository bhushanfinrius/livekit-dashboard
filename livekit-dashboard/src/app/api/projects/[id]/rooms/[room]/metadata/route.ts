import { jsonError, jsonOk } from "@/lib/http";
import {
  liveKitActionError,
  readJsonBody,
  requireProjectLiveKit,
} from "@/lib/api/project";
import { toRoomSnapshot } from "@/lib/livekit";
import { roomNameSchema, updateRoomMetadataSchema } from "@/lib/validators/rooms";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; room: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id, room } = await context.params;
  const parsedRoom = roomNameSchema.safeParse(room);
  if (!parsedRoom.success) {
    return jsonError("Invalid room name", 400, "VALIDATION");
  }

  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const parsed = updateRoomMetadataSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid metadata", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    const updated = await access.livekit.rooms.updateMetadata(
      parsedRoom.data,
      parsed.data.metadata,
    );
    return jsonOk({ ok: true, room: toRoomSnapshot(updated) });
  } catch (error) {
    return liveKitActionError(error);
  }
}
