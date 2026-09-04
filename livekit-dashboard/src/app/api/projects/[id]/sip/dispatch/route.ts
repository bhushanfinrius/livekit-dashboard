import { jsonError, jsonOk } from "@/lib/http";
import {
  liveKitActionError,
  readJsonBody,
  requireProjectLiveKit,
} from "@/lib/api/project";
import { registerProjectRoom, registerProjectRoomPrefix } from "@/lib/events/attribution";
import { toDispatchRuleSnapshot } from "@/lib/livekit";
import { recordingOutputError, roomEgressConfig } from "@/lib/egress/recording";
import { dispatchRuleSchema } from "@/lib/validators/sip";
import { RoomConfiguration } from "livekit-server-sdk";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const parsed = dispatchRuleSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid rule", 400, "VALIDATION");
  }

  if (parsed.data.type === "direct" && !parsed.data.roomName) {
    return jsonError("Direct rules need a room name", 400, "VALIDATION");
  }
  if (parsed.data.type !== "direct" && !parsed.data.roomPrefix) {
    return jsonError("This rule type needs a room prefix", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  const rule =
    parsed.data.type === "direct"
      ? { type: "direct" as const, roomName: parsed.data.roomName ?? "", pin: parsed.data.pin }
      : parsed.data.type === "individual"
        ? { type: "individual" as const, roomPrefix: parsed.data.roomPrefix ?? "", pin: parsed.data.pin }
        : { type: "callee" as const, roomPrefix: parsed.data.roomPrefix ?? "", pin: parsed.data.pin };

  // Inbound calls create their own room, so recording has to be declared on the rule.
  const recordingError = recordingOutputError();

  try {
    const created = await access.livekit.sip.createDispatch(rule, {
      name: parsed.data.name,
      trunkIds: parsed.data.trunkIds,
      metadata: parsed.data.metadata,
      roomConfig: recordingError
        ? undefined
        : new RoomConfiguration({
            egress: roomEgressConfig(
              parsed.data.agentName,
              parsed.data.roomName ?? parsed.data.roomPrefix,
            ),
          }),
    });

    // Inbound rooms are named by LiveKit, so claim the namespace to attribute webhooks.
    if (rule.type === "direct") {
      await registerProjectRoom(id, rule.roomName);
    } else {
      await registerProjectRoomPrefix(id, rule.roomPrefix);
    }

    return jsonOk({ rule: toDispatchRuleSnapshot(created), recordingError }, 201);
  } catch (error) {
    return liveKitActionError(error);
  }
}
