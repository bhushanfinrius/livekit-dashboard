import { jsonError, jsonOk } from "@/lib/http";
import { readJsonBody, requireProjectOwner } from "@/lib/api/project";
import {
  deployAgentWorker,
  inspectAgentWorker,
  purgeAgentWorker,
  stopAgentWorker,
} from "@/lib/livekit/agent-worker";
import { deployAgentWorkerSchema } from "@/lib/validators/sip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function workerError(error: unknown) {
  return jsonError(
    error instanceof Error ? error.message : "Agent worker command failed",
    400,
    "AGENT_WORKER",
  );
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectOwner(id);
  if (access.error) return access.error;

  try {
    return jsonOk(inspectAgentWorker());
  } catch (error) {
    return workerError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectOwner(id);
  if (access.error) return access.error;

  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const parsed = deployAgentWorkerSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid deploy", 400, "VALIDATION");
  }

  try {
    const worker = await deployAgentWorker({
      projectId: id,
      agentName: parsed.data.agentName,
      rebuild: parsed.data.rebuild,
      entrypoint: parsed.data.entrypoint,
      backendBaseUrl: parsed.data.backendBaseUrl,
      backendWebhookUrl: parsed.data.backendWebhookUrl,
      skipCreditCheck: parsed.data.skipCreditCheck,
    });
    return jsonOk(worker, parsed.data.rebuild === false ? 200 : 201);
  } catch (error) {
    return workerError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectOwner(id);
  if (access.error) return access.error;

  let purge = false;
  try {
    const body = (await request.json()) as { purge?: boolean };
    purge = Boolean(body?.purge);
  } catch {
    purge = false;
  }

  try {
    return jsonOk(purge ? purgeAgentWorker() : stopAgentWorker());
  } catch (error) {
    return workerError(error);
  }
}
