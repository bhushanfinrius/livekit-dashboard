import { jsonError, jsonOk } from "@/lib/http";
import {
  liveKitActionError,
  readJsonBody,
  requireProjectLiveKit,
} from "@/lib/api/project";
import { toAgentDispatchSnapshot } from "@/lib/livekit";
import { ensureRoomWithAutoTrackEgress } from "@/lib/egress/recording";
import { agentDispatchSchema, deleteDispatchSchema } from "@/lib/validators/sip";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const parsed = agentDispatchSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid dispatch", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    const roomResult = await ensureRoomWithAutoTrackEgress(
      access.livekit,
      parsed.data.roomName,
      parsed.data.agentName,
    );
    if (roomResult.reason === "error" || roomResult.reason === "unconfigured") {
      console.error("[recording:auto-track]", parsed.data.roomName, roomResult.error ?? roomResult.reason);
    }
    const dispatch = await access.livekit.agents.createDispatch(
      parsed.data.roomName,
      parsed.data.agentName,
      parsed.data.metadata,
    );
    return jsonOk({ dispatch: toAgentDispatchSnapshot(dispatch) }, 201);
  } catch (error) {
    return liveKitActionError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const parsed = deleteDispatchSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid dispatch", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    await access.livekit.agents.deleteDispatch(parsed.data.dispatchId, parsed.data.roomName);
    return jsonOk({ ok: true });
  } catch (error) {
    return liveKitActionError(error);
  }
}
