import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

const JOIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createJoinCode(length = 8) {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += JOIN_ALPHABET[bytes[i]! % JOIN_ALPHABET.length];
  }
  return out;
}

export async function getUserMemberships(userId: string) {
  return prisma.membership.findMany({
    where: { userId },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          joinCode: true,
          createdAt: true,
        },
      },
    },
    orderBy: { project: { createdAt: "asc" } },
  });
}

export async function getMembership(userId: string, projectId: string) {
  return prisma.membership.findUnique({
    where: { userId_projectId: { userId, projectId } },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          joinCode: true,
          livekitUrl: true,
          publicLivekitUrl: true,
          livekitApiKey: true,
          createdAt: true,
        },
      },
    },
  });
}

export type ProjectOption = {
  id: string;
  name: string;
};

export type MemberSnapshot = {
  userId: string;
  email: string;
  name: string | null;
  role: "owner" | "member";
};

export async function listProjectMembers(projectId: string): Promise<MemberSnapshot[]> {
  const rows = await prisma.membership.findMany({
    where: { projectId },
    orderBy: [{ role: "desc" }, { user: { email: "asc" } }],
    select: {
      userId: true,
      role: true,
      user: { select: { email: true, name: true } },
    },
  });

  return rows.map((row) => ({
    userId: row.userId,
    email: row.user.email,
    name: row.user.name,
    role: row.role === "owner" ? "owner" : "member",
  }));
}

export async function countOwners(projectId: string) {
  return prisma.membership.count({
    where: { projectId, role: "owner" },
  });
}
