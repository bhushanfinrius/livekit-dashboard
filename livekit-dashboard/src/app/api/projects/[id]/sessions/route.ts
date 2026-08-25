import { jsonError, jsonOk } from "@/lib/http";
import { liveKitActionError, requireProjectLiveKit } from "@/lib/api/project";
import { isOverviewRange } from "@/lib/overview/types";
import { loadSessions } from "@/lib/sessions/load";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const rangeParam = new URL(request.url).searchParams.get("range") ?? "7d";
  if (!isOverviewRange(rangeParam)) {
    return jsonError("range must be 24h, 7d, or 30d", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    const payload = await loadSessions(id, rangeParam);
    return jsonOk(payload);
  } catch (error) {
    return liveKitActionError(error);
  }
}
