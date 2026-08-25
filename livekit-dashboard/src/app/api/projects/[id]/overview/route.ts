import { jsonError, jsonOk } from "@/lib/http";
import { liveKitActionError, requireProjectLiveKit } from "@/lib/api/project";
import { loadOverview } from "@/lib/overview/load";
import { isOverviewRange } from "@/lib/overview/types";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const rangeParam = new URL(request.url).searchParams.get("range") ?? "24h";
  if (!isOverviewRange(rangeParam)) {
    return jsonError("range must be 24h, 7d, or 30d", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    const overview = await loadOverview(access.livekit, rangeParam);
    return jsonOk(overview);
  } catch (error) {
    return liveKitActionError(error);
  }
}
