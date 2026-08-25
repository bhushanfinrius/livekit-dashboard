import { jsonError, jsonOk } from "@/lib/http";
import { liveKitActionError, requireProjectLiveKit } from "@/lib/api/project";
import { toEgressSnapshot } from "@/lib/livekit";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; egressId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id, egressId } = await context.params;
  if (!egressId.trim()) {
    return jsonError("Egress id is required", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    const job = await access.livekit.egress.stop(egressId);
    return jsonOk({ egress: toEgressSnapshot(job) });
  } catch (error) {
    return liveKitActionError(error);
  }
}
