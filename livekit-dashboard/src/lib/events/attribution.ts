import { prisma } from "@/lib/db";

/**
 * Every project has its own LiveKit API key, but only one of them — the infra key —
 * signs webhooks, so the JWT issuer cannot say which project an event belongs to.
 * Rooms carry that ownership instead.
 */
export async function registerProjectRoom(projectId: string, roomName: string) {
  const name = roomName.trim();
  if (!name) return;
  await prisma.projectRoom.upsert({
    where: { name },
    update: { projectId },
    create: { projectId, name },
  });
}

/** Inbound SIP rooms are named by LiveKit from a dispatch rule's prefix, never by us. */
export async function registerProjectRoomPrefix(projectId: string, prefix: string) {
  const value = prefix.trim();
  if (!value) return;
  await prisma.projectRoomPrefix.upsert({
    where: { projectId_prefix: { projectId, prefix: value } },
    update: {},
    create: { projectId, prefix: value },
  });
}

/**
 * Exact room, then longest registered prefix, then — on a single-tenant install — the
 * only project. Returns null rather than guessing between several projects.
 */
export async function resolveProjectIdForRoom(roomName: string | null | undefined) {
  const name = roomName?.trim();

  if (name) {
    const room = await prisma.projectRoom.findUnique({
      where: { name },
      select: { projectId: true },
    });
    if (room) return room.projectId;

    const prefixes = await prisma.projectRoomPrefix.findMany({
      select: { projectId: true, prefix: true },
    });
    const matches = prefixes
      .filter((row) => name.startsWith(row.prefix))
      .sort((a, b) => b.prefix.length - a.prefix.length);
    if (matches.length > 0) return matches[0].projectId;
  }

  const projects = await prisma.project.findMany({ select: { id: true }, take: 2 });
  return projects.length === 1 ? projects[0].id : null;
}
