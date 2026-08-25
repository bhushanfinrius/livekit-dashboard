import { jsonError, jsonOk } from "@/lib/http";
import { requireProjectOwner } from "@/lib/api/project";
import { agentWorkerLogs } from "@/lib/livekit/agent-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectOwner(id);
  if (access.error) return access.error;

  try {
    return jsonOk({ logs: agentWorkerLogs() });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not read agent logs",
      400,
      "AGENT_WORKER",
    );
  }
}
