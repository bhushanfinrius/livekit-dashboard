import { Prisma } from "@/generated/prisma";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { joinProjectSchema } from "@/lib/validators/auth";

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

  const parsed = joinProjectSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Invalid input";
    return jsonError(first, 400, "VALIDATION");
  }

  const project = await prisma.project.findUnique({
    where: { joinCode: parsed.data.joinCode },
    select: { id: true, name: true, joinCode: true },
  });

  if (!project) {
    return jsonError("No project found for that join code", 404, "NOT_FOUND");
  }

  try {
    await prisma.membership.create({
      data: {
        userId: session.user.id,
        projectId: project.id,
        role: "member",
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonOk({ ...project, alreadyMember: true });
    }
    throw error;
  }

  return jsonOk({ ...project, alreadyMember: false }, 201);
}
