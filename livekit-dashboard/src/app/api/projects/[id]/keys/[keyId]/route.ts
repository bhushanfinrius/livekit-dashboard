import { jsonError, jsonOk } from "@/lib/http";
import { requireProjectOwner } from "@/lib/api/project";
import { prisma } from "@/lib/db";
import { PRIMARY_KEY_ID } from "@/lib/keys/project-keys";
import { revokeLocalLiveKitKey } from "@/lib/livekit/apply-local-keys";
import { isLocalLiveKitUrl } from "@/lib/livekit/local-defaults";
import { liveKitErrorMessage } from "@/lib/livekit/errors";

export const runtime = "nodejs";
export const maxDuration = 120;

type RouteContext = {
  params: Promise<{ id: string; keyId: string }>;
};

/**
 * Soft delete by default: the row goes and the pair returns to the free pool, but LiveKit
 * only reads its key map at startup so the key keeps working until the server restarts.
 * `?revoke=true` rewrites livekit.yaml and recreates the services so it stops immediately.
 */
export async function DELETE(request: Request, context: RouteContext) {
  const { id, keyId } = await context.params;
  const access = await requireProjectOwner(id);
  if ("error" in access) return access.error;

  if (keyId === PRIMARY_KEY_ID) {
    return jsonError(
      "This is the project's primary key, which LumiVoice uses for its own calls. Rotate it instead of deleting it.",
      400,
      "VALIDATION",
    );
  }

  const key = await prisma.projectApiKey.findFirst({
    where: { id: keyId, projectId: id },
    select: { id: true, apiKey: true },
  });
  if (!key) return jsonError("Key not found", 404, "NOT_FOUND");

  const project = await prisma.project.findUnique({
    where: { id },
    select: { livekitUrl: true },
  });
  const hardRevoke = new URL(request.url).searchParams.get("revoke") === "true";

  if (hardRevoke) {
    if (!project || !isLocalLiveKitUrl(project.livekitUrl)) {
      return jsonError(
        "Revoke now only works for the self-hosted LiveKit. Remove the key from your LiveKit provider, then delete it here.",
        400,
        "VALIDATION",
      );
    }
    try {
      await revokeLocalLiveKitKey(key.apiKey);
    } catch (error) {
      return jsonError(
        error instanceof Error ? error.message : liveKitErrorMessage(error),
        400,
        "LIVEKIT",
      );
    }
  }

  await prisma.projectApiKey.delete({ where: { id: key.id } });
  return jsonOk({ deleted: true, revoked: hardRevoke });
}
