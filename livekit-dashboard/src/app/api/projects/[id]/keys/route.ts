import { auth } from "@/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { requireProjectMember, requireProjectOwner } from "@/lib/api/project";
import { prisma } from "@/lib/db";
import { listProjectApiKeys } from "@/lib/keys/project-keys";
import { applyLocalLiveKitKeys } from "@/lib/livekit/apply-local-keys";
import { assignProjectKeyPair, encryptLiveKitSecret } from "@/lib/livekit/service";
import { liveKitErrorMessage } from "@/lib/livekit/errors";

export const runtime = "nodejs";
export const maxDuration = 120;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function errorResponse(error: unknown, status = 400) {
  return jsonError(
    error instanceof Error ? error.message : liveKitErrorMessage(error),
    status,
    "LIVEKIT",
  );
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectMember(id);
  if ("error" in access) return access.error;

  const isOwner = access.membership.role === "owner";
  const keys = await listProjectApiKeys(id, isOwner);
  if (!keys) return jsonError("Project not found", 404, "NOT_FOUND");
  return jsonOk({ canManage: isOwner, keys });
}

/**
 * Adds a key by default. The pair already exists in livekit.yaml's pool, so this is a
 * database write only: no restart, and it works from inside the deck container.
 *
 * `{ rotatePrimary: true }` instead replaces the project's own pair, which does have to
 * rewrite the YAML and recreate LiveKit.
 */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectOwner(id);
  if ("error" in access) return access.error;

  let body: { name?: string; rotatePrimary?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // No body: add a key with a default name.
  }

  const current = await prisma.project.findUnique({
    where: { id },
    select: { livekitApiKey: true, name: true },
  });
  if (!current) return jsonError("Project not found", 404, "NOT_FOUND");

  if (body.rotatePrimary) {
    try {
      const generated = await applyLocalLiveKitKeys(current.livekitApiKey);
      await prisma.project.update({
        where: { id },
        data: {
          livekitApiKey: generated.apiKey,
          livekitApiSecret: encryptLiveKitSecret(generated.apiSecret),
          livekitUrl: generated.url,
        },
      });
      const keys = await listProjectApiKeys(id, true);
      const primary = keys?.find((key) => key.isPrimary);
      if (!primary) return jsonError("Project not found", 404, "NOT_FOUND");
      return jsonOk({ ...primary, apiSecret: generated.apiSecret }, 201);
    } catch (error) {
      return errorResponse(error);
    }
  }

  const session = await auth();
  const existing = await prisma.projectApiKey.count({ where: { projectId: id } });
  const name = body.name?.trim() || `${current.name} key ${existing + 2}`;

  let pair;
  try {
    pair = await assignProjectKeyPair();
  } catch (error) {
    return errorResponse(error, 409);
  }

  const created = await prisma.projectApiKey.create({
    data: {
      projectId: id,
      apiKey: pair.apiKey,
      apiSecret: encryptLiveKitSecret(pair.apiSecret),
      name,
      createdByEmail: session?.user?.email ?? null,
    },
    select: { id: true, name: true, createdByEmail: true, createdAt: true },
  });

  return jsonOk(
    {
      id: created.id,
      apiKey: pair.apiKey,
      // The only time the secret crosses the wire; owners can read it back from GET.
      apiSecret: pair.apiSecret,
      name: created.name,
      owner: created.createdByEmail || "Owner",
      issuedAt: created.createdAt.toISOString(),
      isPrimary: false,
    },
    201,
  );
}
