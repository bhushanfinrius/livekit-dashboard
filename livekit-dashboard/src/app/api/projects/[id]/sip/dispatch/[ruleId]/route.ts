import { jsonError, jsonOk } from "@/lib/http";
import { liveKitActionError, requireProjectLiveKit } from "@/lib/api/project";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; ruleId: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  const { id, ruleId } = await context.params;
  if (!ruleId) {
    return jsonError("Rule id is required", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    await access.livekit.sip.deleteDispatch(ruleId);
    return jsonOk({ ok: true });
  } catch (error) {
    return liveKitActionError(error);
  }
}
