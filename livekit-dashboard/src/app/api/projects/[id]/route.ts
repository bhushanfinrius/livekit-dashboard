import { auth } from "@/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { liveKitActionError, readJsonBody, requireProjectOwner } from "@/lib/api/project";
import { decryptSecret } from "@/lib/crypto/secret";
import { prisma } from "@/lib/db";
import {
  encryptLiveKitSecret,
  getProjectLiveKit,
  liveKitErrorMessage,
  ProjectAccessError,
  toHttpLivekitUrl,
  toWsLivekitUrl,
  verifyLiveKitCredentials,
} from "@/lib/livekit";
import { deleteProjectSchema, updateProjectSchema } from "@/lib/validators/auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const { id } = await context.params;

  try {
    const livekit = await getProjectLiveKit(session.user.id, id);
    const rooms = await livekit.rooms.list();
    return jsonOk({
      id: livekit.projectId,
      name: livekit.name,
      livekitUrl: livekit.livekitUrl,
      publicLivekitUrl: livekit.publicLivekitUrl,
      livekitApiKey: livekit.livekitApiKey,
      live: {
        reachable: true,
        activeRooms: rooms.length,
      },
    });
  } catch (error) {
    if (error instanceof ProjectAccessError) {
      return jsonError(error.message, error.status, error.code);
    }
    return jsonError(liveKitErrorMessage(error), 502, "LIVEKIT");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectOwner(id);
  if (access.error) return access.error;

  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const parsed = updateProjectSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid project update", 400, "VALIDATION");
  }

  const current = await prisma.project.findUnique({
    where: { id },
    select: {
      name: true,
      livekitUrl: true,
      publicLivekitUrl: true,
      livekitApiKey: true,
      livekitApiSecret: true,
    },
  });
  if (!current) {
    return jsonError("Project not found", 404, "NOT_FOUND");
  }

  const nextName = parsed.data.name ?? current.name;
  const nextSecretRaw = parsed.data.livekitApiSecret?.trim();
  const storedSecret = decryptSecret(current.livekitApiSecret);

  const livekitUrl = parsed.data.livekitUrl ? toHttpLivekitUrl(parsed.data.livekitUrl) : current.livekitUrl;
  const livekitApiKey = parsed.data.livekitApiKey ?? current.livekitApiKey;
  const livekitApiSecret = nextSecretRaw || storedSecret;
  let publicLivekitUrl = current.publicLivekitUrl;
  if (parsed.data.publicLivekitUrl !== undefined) {
    const nextPublic = parsed.data.publicLivekitUrl.trim();
    publicLivekitUrl = nextPublic ? toWsLivekitUrl(nextPublic) : null;
  }

  const credentialsChanged =
    livekitUrl !== current.livekitUrl ||
    livekitApiKey !== current.livekitApiKey ||
    Boolean(nextSecretRaw);

  if (credentialsChanged) {
    try {
      await verifyLiveKitCredentials({ livekitUrl, livekitApiKey, livekitApiSecret });
    } catch (error) {
      return jsonError(liveKitErrorMessage(error), 400, "LIVEKIT");
    }
  }

  const project = await prisma.project.update({
    where: { id },
    data: {
      name: nextName,
      livekitUrl,
      publicLivekitUrl,
      livekitApiKey,
      ...(nextSecretRaw ? { livekitApiSecret: encryptLiveKitSecret(livekitApiSecret) } : {}),
    },
    select: {
      id: true,
      name: true,
      livekitUrl: true,
      publicLivekitUrl: true,
      livekitApiKey: true,
      joinCode: true,
    },
  });

  return jsonOk(project);
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectOwner(id);
  if (access.error) return access.error;

  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const parsed = deleteProjectSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Confirmation required", 400, "VALIDATION");
  }

  if (parsed.data.confirmName !== access.membership.project.name) {
    return jsonError("Project name does not match", 400, "VALIDATION");
  }

  try {
    await prisma.project.delete({ where: { id } });
    return jsonOk({ ok: true });
  } catch (error) {
    return liveKitActionError(error);
  }
}
