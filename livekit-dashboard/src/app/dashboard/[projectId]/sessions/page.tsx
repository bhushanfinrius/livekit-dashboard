import type { Metadata } from "next";
import { auth } from "@/auth";
import { EmptyState } from "@/components/empty-state";
import { SessionsView } from "@/components/sessions/sessions-view";
import { getMembership } from "@/lib/projects";
import { loadSessions } from "@/lib/sessions/load";

export const metadata: Metadata = {
  title: "Sessions",
};

export const dynamic = "force-dynamic";

export default async function SessionsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <EmptyState
        title="Sessions are not available"
        description="Sign in to see past rooms reconstructed from webhook history."
      />
    );
  }

  const membership = await getMembership(session.user.id, projectId);
  if (!membership) {
    return (
      <EmptyState
        title="Sessions are not available"
        description="You need access to this project to view its session history."
      />
    );
  }

  const initial = await loadSessions(projectId, "7d");
  return <SessionsView projectId={projectId} initial={initial} />;
}
