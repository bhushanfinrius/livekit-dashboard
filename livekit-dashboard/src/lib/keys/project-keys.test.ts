import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    project: { findUnique: (...args: unknown[]) => findUnique(...args) },
  },
}));

vi.mock("@/lib/crypto/secret", () => ({
  decryptSecret: (value: string) => `plain:${value}`,
}));

const { PRIMARY_KEY_ID, listProjectApiKeys } = await import("@/lib/keys/project-keys");

const project = {
  name: "demo",
  livekitApiKey: "deck_primary",
  livekitApiSecret: "enc_primary",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  memberships: [{ user: { email: "owner@example.com", name: "Ada" } }],
  apiKeys: [
    {
      id: "key_1",
      apiKey: "deck_extra",
      apiSecret: "enc_extra",
      name: "backend",
      createdByEmail: "ada@example.com",
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
    },
  ],
};

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue(project);
});

describe("listProjectApiKeys", () => {
  it("returns the primary first, then extra keys, hiding secrets from non-owners", async () => {
    const keys = await listProjectApiKeys("p1", false);
    expect(keys).toHaveLength(2);
    expect(keys?.[0]).toMatchObject({
      id: PRIMARY_KEY_ID,
      apiKey: "deck_primary",
      apiSecret: null,
      isPrimary: true,
      owner: "Ada",
    });
    expect(keys?.[1]).toMatchObject({
      id: "key_1",
      apiKey: "deck_extra",
      apiSecret: null,
      name: "backend",
      isPrimary: false,
      owner: "ada@example.com",
    });
  });

  it("decrypts secrets for owners", async () => {
    const keys = await listProjectApiKeys("p1", true);
    expect(keys?.[0].apiSecret).toBe("plain:enc_primary");
    expect(keys?.[1].apiSecret).toBe("plain:enc_extra");
  });

  it("returns null when the project is missing", async () => {
    findUnique.mockResolvedValue(null);
    await expect(listProjectApiKeys("missing", true)).resolves.toBeNull();
  });
});
