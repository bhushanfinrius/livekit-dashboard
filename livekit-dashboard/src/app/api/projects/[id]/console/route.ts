import { jsonError, jsonOk } from "@/lib/http";
import {
  liveKitActionError,
  readJsonBody,
  requireProjectLiveKit,
  requireProjectOwner,
} from "@/lib/api/project";
import { startRoomRecordingInBackground } from "@/lib/egress/recording";
import { inspectAgentWorker } from "@/lib/livekit/agent-worker";
import { isLoopbackLivekitUrl } from "@/lib/livekit/url";
import { consoleTokenSchema } from "@/lib/validators/console";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function shortRoomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const parsed = consoleTokenSchema.safeParse(body.data ?? {});
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid console request", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  const dispatchAgent = Boolean(parsed.data.dispatchAgent);
  if (dispatchAgent) {
    const owner = await requireProjectOwner(id);
    if (owner.error) return owner.error;
  }
  const worker = dispatchAgent ? inspectAgentWorker() : null;
  const agentName = parsed.data.agentName?.trim() || worker?.agentName?.trim() || "";
  if (dispatchAgent && !agentName) {
    return jsonError("Deploy an agent before Talk.", 400, "VALIDATION");
  }

  const roomName = parsed.data.roomName?.trim() || `deck-console-${shortRoomSuffix()}`;
  const identity = `deck-${access.livekit.projectId.slice(0, 8)}-${shortRoomSuffix()}`;
  const wsUrl = access.livekit.browserWsUrl;

  try {
    const token = await access.livekit.tokens.mintParticipant({
      identity,
      name: "Deck",
      roomName,
    });
    startRoomRecordingInBackground(access.livekit, roomName);
    return jsonOk({
      token,
      wsUrl,
      roomName,
      agentName: dispatchAgent ? agentName : null,
      loopback: isLoopbackLivekitUrl(wsUrl),
    });
  } catch (error) {
    return liveKitActionError(error);
  }
}
