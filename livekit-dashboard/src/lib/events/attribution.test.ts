import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const findManyPrefixes = vi.fn();
const findManyProjects = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    projectRoom: { findUnique: (...args: unknown[]) => findUnique(...args) },
    projectRoomPrefix: { findMany: (...args: unknown[]) => findManyPrefixes(...args) },
    project: { findMany: (...args: unknown[]) => findManyProjects(...args) },
  },
}));

const { resolveProjectIdForRoom } = await import("@/lib/events/attribution");

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue(null);
  findManyPrefixes.mockReset().mockResolvedValue([]);
  findManyProjects.mockReset().mockResolvedValue([]);
});

describe("resolveProjectIdForRoom", () => {
  it("prefers an exact room registration", async () => {
    findUnique.mockResolvedValue({ projectId: "p-exact" });
    findManyPrefixes.mockResolvedValue([{ projectId: "p-prefix", prefix: "call-" }]);
    expect(await resolveProjectIdForRoom("call-123")).toBe("p-exact");
  });

  it("falls back to the longest matching prefix", async () => {
    findManyPrefixes.mockResolvedValue([
      { projectId: "p-short", prefix: "call-" },
      { projectId: "p-long", prefix: "call-support-" },
    ]);
    expect(await resolveProjectIdForRoom("call-support-9")).toBe("p-long");
  });

  it("uses the only project when nothing matches", async () => {
    findManyProjects.mockResolvedValue([{ id: "p-solo" }]);
    expect(await resolveProjectIdForRoom("mystery-room")).toBe("p-solo");
  });

  it("matches a project id embedded in the room name", async () => {
    findManyProjects.mockResolvedValue([
      { id: "clabcdefghijk" },
      { id: "clotherproject" },
    ]);
    expect(await resolveProjectIdForRoom("test-clabcdefghijk-20260903")).toBe("clabcdefghijk");
  });

  it("matches a unique 8-char project id prefix in the room name", async () => {
    findManyProjects.mockResolvedValue([
      { id: "clabcdefghijk" },
      { id: "clotherproject" },
    ]);
    expect(await resolveProjectIdForRoom("test-clabcdef-20260903")).toBe("clabcdefghijk");
  });

  it("refuses to guess between several projects", async () => {
    findManyProjects.mockResolvedValue([{ id: "p-a" }, { id: "p-b" }]);
    expect(await resolveProjectIdForRoom("mystery-room")).toBeNull();
  });

  it("still resolves a single-project install with no room name", async () => {
    findManyProjects.mockResolvedValue([{ id: "p-solo" }]);
    expect(await resolveProjectIdForRoom(undefined)).toBe("p-solo");
    expect(findUnique).not.toHaveBeenCalled();
  });
});
