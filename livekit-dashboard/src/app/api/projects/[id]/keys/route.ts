import { jsonError, jsonOk } from "@/lib/http";
import { requireProjectMember, requireProjectOwner } from "@/lib/api/project";
import { decryptSecret } from "@/lib/crypto/secret";
import { prisma } from "@/lib/db";
import { applyLocalLiveKitKeys } from "@/lib/livekit/apply-local-keys";
import { encryptLiveKitSecret } from "@/lib/livekit/service";
import { liveKitErrorMessage } from "@/lib/livekit/errors";

export const runtime = "nodejs";
export const maxDuration = 120;

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function keyPayload(projectId: string, includeSecret: boolean) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      livekitApiKey: true,
      livekitApiSecret: true,
      createdAt: true,
      memberships: {
        where: { role: "owner" },
        take: 1,
        select: { user: { select: { email: true, name: true } } },
      },
    },
  });
  if (!project) return null;
  const owner = project.memberships[0]?.user;
  return {
    apiKey: project.livekitApiKey,
    apiSecret: includeSecret ? decryptSecret(project.livekitApiSecret) : null,
    description: project.name,
    owner: owner?.name || owner?.email || "Owner",
    issuedAt: project.createdAt.toISOString(),
  };
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectMember(id);
  if ("error" in access) return access.error;

  const isOwner = access.membership.role === "owner";
  const row = await keyPayload(id, isOwner);
  if (!row) return jsonError("Project not found", 404, "NOT_FOUND");
  return jsonOk({ canManage: isOwner, keys: [row] });
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectOwner(id);
  if ("error" in access) return access.error;

  try {
    const generated = await applyLocalLiveKitKeys("generate");
    await prisma.project.update({
      where: { id },
      data: {
        livekitApiKey: generated.apiKey,
        livekitApiSecret: encryptLiveKitSecret(generated.apiSecret),
        livekitUrl: generated.url,
      },
    });
    const row = await keyPayload(id, true);
    if (!row) return jsonError("Project not found", 404, "NOT_FOUND");
    return jsonOk({ ...row, apiSecret: generated.apiSecret }, 201);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : liveKitErrorMessage(error),
      400,
      "LIVEKIT",
    );
  }
}
