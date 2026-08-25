import type { Metadata } from "next";
import { auth } from "@/auth";
import { EmptyState } from "@/components/empty-state";
import { CallsView } from "@/components/telephony/calls-view";
import { getMembership } from "@/lib/projects";
import { loadSipCalls } from "@/lib/telephony/load";

export const metadata: Metadata = {
  title: "Calls",
};

export const dynamic = "force-dynamic";

export default async function CallsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <EmptyState
        title="Calls are not available"
        description="Sign in to see SIP calls reconstructed from webhook history."
      />
    );
  }
  const membership = await getMembership(session.user.id, projectId);
  if (!membership) {
    return (
      <EmptyState
        title="Calls are not available"
        description="You need access to this project to view its SIP calls."
      />
    );
  }

  const initial = await loadSipCalls(projectId, "24h");
  return <CallsView projectId={projectId} initial={initial} />;
}
