import { decryptSecret } from "@/lib/crypto/secret";
import { prisma } from "@/lib/db";

/** Sentinel id for the pair stored on the Project row itself. */
export const PRIMARY_KEY_ID = "primary";

export type ProjectApiKeyRow = {
  id: string;
  apiKey: string;
  /** Null for non-owners: only owners may read secrets back. */
  apiSecret: string | null;
  name: string;
  owner: string;
  issuedAt: string;
  /** The pair LumiVoice itself uses for Talk, room create, SIP dial and egress. */
  isPrimary: boolean;
};

/**
 * The project's primary pair first, then the extra keys it has issued, oldest first.
 * Returns null when the project does not exist.
 */
export async function listProjectApiKeys(
  projectId: string,
  includeSecrets: boolean,
): Promise<ProjectApiKeyRow[] | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      livekitApiKey: true,
      livekitApiSecret: true,
      createdAt: true,
      memberships: {
        where: { role: "owner" },
        take: 1,
        select: { user: { select: { email: true, name: true } } },
      },
      apiKeys: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          apiKey: true,
          apiSecret: true,
          name: true,
          createdByEmail: true,
          createdAt: true,
        },
      },
    },
  });
  if (!project) return null;

  const ownerUser = project.memberships[0]?.user;
  const projectOwner = ownerUser?.name || ownerUser?.email || "Owner";

  return [
    {
      id: PRIMARY_KEY_ID,
      apiKey: project.livekitApiKey,
      apiSecret: includeSecrets ? decryptSecret(project.livekitApiSecret) : null,
      name: project.name,
      owner: projectOwner,
      issuedAt: project.createdAt.toISOString(),
      isPrimary: true,
    },
    ...project.apiKeys.map((row) => ({
      id: row.id,
      apiKey: row.apiKey,
      apiSecret: includeSecrets ? decryptSecret(row.apiSecret) : null,
      name: row.name,
      owner: row.createdByEmail || projectOwner,
      issuedAt: row.createdAt.toISOString(),
      isPrimary: false,
    })),
  ];
}
