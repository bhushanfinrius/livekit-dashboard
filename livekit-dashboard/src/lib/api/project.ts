import { auth } from "@/auth";
import { jsonError } from "@/lib/http";
import {
  getProjectLiveKit,
  liveKitErrorMessage,
  ProjectAccessError,
  type ProjectLiveKit,
} from "@/lib/livekit";
import { getMembership } from "@/lib/projects";

export async function requireProjectLiveKit(projectId: string): Promise<
  { livekit: ProjectLiveKit; error?: never } | { livekit?: never; error: Response }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: jsonError("Unauthorized", 401, "UNAUTHORIZED") };
  }

  try {
    const livekit = await getProjectLiveKit(session.user.id, projectId);
    return { livekit };
  } catch (error) {
    if (error instanceof ProjectAccessError) {
      return { error: jsonError(error.message, error.status, error.code) };
    }
    return { error: jsonError(liveKitErrorMessage(error), 502, "LIVEKIT") };
  }
}

export async function readJsonBody(request: Request) {
  try {
    return { data: (await request.json()) as unknown };
  } catch {
    return { error: jsonError("Invalid JSON body", 400, "VALIDATION") };
  }
}

export function liveKitActionError(error: unknown) {
  if (error instanceof ProjectAccessError) {
    return jsonError(error.message, error.status, error.code);
  }
  return jsonError(liveKitErrorMessage(error), 502, "LIVEKIT");
}

export async function requireProjectMember(projectId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: jsonError("Unauthorized", 401, "UNAUTHORIZED") } as const;
  }

  const membership = await getMembership(session.user.id, projectId);
  if (!membership) {
    return { error: jsonError("Project not found", 404, "NOT_FOUND") } as const;
  }

  return { userId: session.user.id, membership } as const;
}

export async function requireProjectOwner(projectId: string) {
  const access = await requireProjectMember(projectId);
  if ("error" in access) return access;
  if (access.membership.role !== "owner") {
    return { error: jsonError("Only project owners can do that", 403, "FORBIDDEN") } as const;
  }
  return access;
}
