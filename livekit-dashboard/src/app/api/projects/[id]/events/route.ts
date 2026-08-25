import { jsonError, jsonOk } from "@/lib/http";
import { liveKitActionError, requireProjectLiveKit } from "@/lib/api/project";
import { listWebhookEvents } from "@/lib/events/store";
import { eventLogQuerySchema } from "@/lib/validators/events";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = eventLogQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid query", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    const payload = await listWebhookEvents(id, {
      type: parsed.data.type || undefined,
      q: parsed.data.q || undefined,
      range: parsed.data.range,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    });
    return jsonOk(payload);
  } catch (error) {
    return liveKitActionError(error);
  }
}
