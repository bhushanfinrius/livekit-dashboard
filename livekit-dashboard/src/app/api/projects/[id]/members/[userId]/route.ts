import { jsonError, jsonOk } from "@/lib/http";
import { readJsonBody, requireProjectMember, requireProjectOwner } from "@/lib/api/project";
import { prisma } from "@/lib/db";
import { countOwners, listProjectMembers } from "@/lib/projects";
import { updateMemberRoleSchema } from "@/lib/validators/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; userId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id, userId } = await context.params;
  const access = await requireProjectOwner(id);
  if (access.error) return access.error;

  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const parsed = updateMemberRoleSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid role", 400, "VALIDATION");
  }

  const target = await prisma.membership.findUnique({
    where: { userId_projectId: { userId, projectId: id } },
    select: { role: true },
  });
  if (!target) {
    return jsonError("Member not found", 404, "NOT_FOUND");
  }

  if (target.role === "owner" && parsed.data.role !== "owner") {
    const owners = await countOwners(id);
    if (owners <= 1) {
      return jsonError("A project must keep at least one owner", 400, "VALIDATION");
    }
  }

  await prisma.membership.update({
    where: { userId_projectId: { userId, projectId: id } },
    data: { role: parsed.data.role },
  });

  return jsonOk({ members: await listProjectMembers(id) });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id, userId } = await context.params;
  const access = await requireProjectMember(id);
  if (access.error) return access.error;

  const isSelf = access.userId === userId;
  if (!isSelf && access.membership.role !== "owner") {
    return jsonError("Only project owners can remove other members", 403, "FORBIDDEN");
  }

  const target = await prisma.membership.findUnique({
    where: { userId_projectId: { userId, projectId: id } },
    select: { role: true },
  });
  if (!target) {
    return jsonError("Member not found", 404, "NOT_FOUND");
  }

  if (target.role === "owner") {
    const owners = await countOwners(id);
    if (owners <= 1) {
      return jsonError("A project must keep at least one owner", 400, "VALIDATION");
    }
  }

  await prisma.membership.delete({
    where: { userId_projectId: { userId, projectId: id } },
  });

  if (isSelf) {
    return jsonOk({ ok: true, left: true });
  }

  return jsonOk({ members: await listProjectMembers(id) });
}
