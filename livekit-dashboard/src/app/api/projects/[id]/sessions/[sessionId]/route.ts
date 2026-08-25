import { jsonError, jsonOk } from "@/lib/http";
import { liveKitActionError, requireProjectLiveKit } from "@/lib/api/project";
import { loadSessionDetail } from "@/lib/sessions/load";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; sessionId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id, sessionId } = await context.params;
  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    const payload = await loadSessionDetail(id, decodeURIComponent(sessionId), access.livekit);
    if (!payload) return jsonError("Session not found in the last 30 days", 404, "NOT_FOUND");
    return jsonOk(payload);
  } catch (error) {
    return liveKitActionError(error);
  }
}
