import type { Metadata } from "next";
import { auth } from "@/auth";
import { EmptyState } from "@/components/empty-state";
import { ApiKeysView } from "@/components/keys/api-keys-view";
import { listProjectApiKeys } from "@/lib/keys/project-keys";
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

  const isOwner = membership.role === "owner";
  const keys = await listProjectApiKeys(projectId, isOwner);

  if (!keys) {
    return (
      <EmptyState
        title="API keys are not available"
        description="This project could not be loaded."
      />
    );
  }

  return <ApiKeysView projectId={projectId} canManage={isOwner} initialKeys={keys} />;
}
