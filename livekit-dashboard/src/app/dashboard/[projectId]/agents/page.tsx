import type { Metadata } from "next";
import { auth } from "@/auth";
import { AgentsView } from "@/components/agents/agents-view";
import { EmptyState } from "@/components/empty-state";
import { getMembership } from "@/lib/projects";

export const metadata: Metadata = {
  title: "Agents",
};

export const dynamic = "force-dynamic";

export default async function AgentsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  const membership = session?.user?.id
    ? await getMembership(session.user.id, projectId)
    : null;

  if (!membership) {
    return (
      <EmptyState
        title="Agents are not available"
        description="You need access to this project to deploy or dispatch agents."
      />
    );
  }

  const canManage = membership.role === "owner";

  return <AgentsView projectId={projectId} canManage={canManage} />;
}
