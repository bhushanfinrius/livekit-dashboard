import type { Metadata } from "next";
import { auth } from "@/auth";
import { EmptyState } from "@/components/empty-state";
import { ApiKeysView } from "@/components/keys/api-keys-view";
import { decryptSecret } from "@/lib/crypto/secret";
import { prisma } from "@/lib/db";
import { getMembership } from "@/lib/projects";

export const metadata: Metadata = {
  title: "API keys",
};

export const dynamic = "force-dynamic";

export default async function ApiKeysPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  const membership = session?.user?.id
    ? await getMembership(session.user.id, projectId)
    : null;

  if (!membership || !session?.user?.id) {
    return (
      <EmptyState
        title="API keys are not available"
        description="You need access to this project to view its keys."
      />
    );
  }

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
    },
  });

  if (!project) {
    return (
      <EmptyState
        title="API keys are not available"
        description="This project could not be loaded."
      />
    );
  }

  const isOwner = membership.role === "owner";
  const owner = project.memberships[0]?.user;

  return (
    <ApiKeysView
      projectId={projectId}
      canManage={isOwner}
      initialKeys={[
        {
          apiKey: project.livekitApiKey,
          apiSecret: isOwner ? decryptSecret(project.livekitApiSecret) : null,
          description: project.name,
          owner: owner?.name || owner?.email || "Owner",
          issuedAt: project.createdAt.toISOString(),
        },
      ]}
    />
  );
}
