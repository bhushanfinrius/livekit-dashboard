import { Prisma } from "@/generated/prisma";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { coerceLocalLiveKitCredentials } from "@/lib/livekit/local-defaults";
import {
  encryptLiveKitSecret,
  liveKitErrorMessage,
  toHttpLivekitUrl,
  verifyLiveKitCredentials,
} from "@/lib/livekit";
import { createJoinCode, getUserMemberships } from "@/lib/projects";
import { createProjectSchema } from "@/lib/validators/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const memberships = await getUserMemberships(session.user.id);
  return jsonOk(
    memberships.map((membership) => ({
      id: membership.project.id,
      name: membership.project.name,
      role: membership.role,
      joinCode: membership.project.joinCode,
      createdAt: membership.project.createdAt,
    })),
  );
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401, "UNAUTHORIZED");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400, "VALIDATION");
  }

  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Invalid input";
    return jsonError(first, 400, "VALIDATION");
  }

  const coerced = coerceLocalLiveKitCredentials(parsed.data);
  const livekitUrl = toHttpLivekitUrl(coerced.livekitUrl);
  const credentials = {
    livekitUrl,
    livekitApiKey: coerced.livekitApiKey,
    livekitApiSecret: coerced.livekitApiSecret,
  };

  try {
    await verifyLiveKitCredentials(credentials);
  } catch (error) {
    return jsonError(liveKitErrorMessage(error), 400, "LIVEKIT");
  }

  let project;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      project = await prisma.project.create({
        data: {
          name: parsed.data.name,
          livekitUrl,
          livekitApiKey: credentials.livekitApiKey,
          livekitApiSecret: encryptLiveKitSecret(credentials.livekitApiSecret),
          joinCode: createJoinCode(),
          memberships: {
            create: {
              userId: session.user.id,
              role: "owner",
            },
          },
        },
        select: {
          id: true,
          name: true,
          joinCode: true,
          livekitUrl: true,
        },
      });
      break;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        attempt < 4
      ) {
        continue;
      }
      throw error;
    }
  }

  if (!project) {
    return jsonError("Could not create project", 500, "CREATE_FAILED");
  }

  return jsonOk(project, 201);
}
