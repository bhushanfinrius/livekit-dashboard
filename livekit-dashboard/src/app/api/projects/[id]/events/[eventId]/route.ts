import { jsonError, jsonOk } from "@/lib/http";
import { liveKitActionError, requireProjectLiveKit } from "@/lib/api/project";
import { getWebhookEvent } from "@/lib/events/store";
import { toLiveWebhookEvent } from "@/lib/events/types";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; eventId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id, eventId } = await context.params;
  if (!eventId.trim()) {
    return jsonError("Event id is required", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    const row = await getWebhookEvent(id, eventId);
    if (!row) {
      return jsonError("Event not found", 404, "NOT_FOUND");
    }
    return jsonOk({
      event: {
        ...toLiveWebhookEvent(row),
        rawPayload: row.rawPayload,
      },
    });
  } catch (error) {
    return liveKitActionError(error);
  }
}
