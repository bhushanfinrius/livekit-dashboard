import { jsonOk } from "@/lib/http";
import { liveKitActionError, requireProjectLiveKit } from "@/lib/api/project";
import { toRoomSnapshot } from "@/lib/livekit";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    const rooms = await access.livekit.rooms.list();
    return jsonOk({ rooms: rooms.map(toRoomSnapshot) });
  } catch (error) {
    return liveKitActionError(error);
  }
}
