import { beforeEach, describe, expect, it, vi } from "vitest";

const projectFindMany = vi.fn();
const apiKeyFindMany = vi.fn();
const readPool = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    project: { findMany: (...args: unknown[]) => projectFindMany(...args) },
    projectApiKey: { findMany: (...args: unknown[]) => apiKeyFindMany(...args) },
  },
}));

vi.mock("@/lib/livekit/apply-local-keys", () => ({
  readLocalLiveKitKeyPool: () => readPool(),
}));

const { assignProjectKeyPair } = await import("@/lib/livekit/service");

const pair = (n: number) => ({ apiKey: `deck_${n}`, apiSecret: `secret_${n}`.padEnd(32, "x") });

beforeEach(() => {
  projectFindMany.mockReset().mockResolvedValue([]);
  apiKeyFindMany.mockReset().mockResolvedValue([]);
  readPool.mockReset().mockReturnValue({ infra: pair(0), pool: [pair(1), pair(2), pair(3)] });
});

describe("assignProjectKeyPair", () => {
  it("returns the first pair no project holds", async () => {
    projectFindMany.mockResolvedValue([{ livekitApiKey: "deck_1" }]);
    await expect(assignProjectKeyPair()).resolves.toMatchObject({ apiKey: "deck_2" });
  });

  it("skips pairs already issued as extra project keys", async () => {
    projectFindMany.mockResolvedValue([{ livekitApiKey: "deck_1" }]);
    apiKeyFindMany.mockResolvedValue([{ apiKey: "deck_2" }]);
    await expect(assignProjectKeyPair()).resolves.toMatchObject({ apiKey: "deck_3" });
  });

  it("reports exhaustion once primaries and extra keys cover the pool", async () => {
    projectFindMany.mockResolvedValue([{ livekitApiKey: "deck_1" }]);
    apiKeyFindMany.mockResolvedValue([{ apiKey: "deck_2" }, { apiKey: "deck_3" }]);
    await expect(assignProjectKeyPair()).rejects.toThrow(/--pool-add 10/);
  });

  it("asks for generation when there is no pool at all", async () => {
    readPool.mockReturnValue({ infra: null, pool: [] });
    await expect(assignProjectKeyPair()).rejects.toThrow(/npm run livekit:keys/);
  });
});
