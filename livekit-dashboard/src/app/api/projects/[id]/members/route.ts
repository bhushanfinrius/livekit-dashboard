import { jsonError, jsonOk } from "@/lib/http";
import { readJsonBody, requireProjectMember, requireProjectOwner } from "@/lib/api/project";
import { prisma } from "@/lib/db";
import { listProjectMembers } from "@/lib/projects";
import { inviteMemberSchema } from "@/lib/validators/auth";
import { Prisma } from "@/generated/prisma";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectMember(id);
  if (access.error) return access.error;

  const members = await listProjectMembers(id);
  return jsonOk({
    members,
    role: access.membership.role,
    joinCode: access.membership.project.joinCode,
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectOwner(id);
  if (access.error) return access.error;

  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const parsed = inviteMemberSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid invite", 400, "VALIDATION");
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    return jsonError(
      "No LumiVoice account with that email. They can sign up, then join with the project code.",
      404,
      "NOT_FOUND",
    );
  }

  try {
    await prisma.membership.create({
      data: {
        userId: user.id,
        projectId: id,
        role: parsed.data.role,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return jsonError("That person is already a member of this project", 409, "CONFLICT");
    }
    throw error;
  }

  const members = await listProjectMembers(id);
  return jsonOk({ members }, 201);
}
