import { jsonError, jsonOk } from "@/lib/http";
import { liveKitActionError, requireProjectLiveKit } from "@/lib/api/project";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; trunkId: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  const { id, trunkId } = await context.params;
  if (!trunkId) {
    return jsonError("Trunk id is required", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    await access.livekit.sip.deleteTrunk(trunkId);
    return jsonOk({ ok: true });
  } catch (error) {
    return liveKitActionError(error);
  }
}
