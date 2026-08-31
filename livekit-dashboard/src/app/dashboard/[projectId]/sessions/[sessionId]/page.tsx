import type { Metadata } from "next";
import { auth } from "@/auth";
import { EmptyState } from "@/components/empty-state";
import { SessionDetailView } from "@/components/sessions/session-detail-view";
import { getProjectLiveKit } from "@/lib/livekit";
import { getMembership } from "@/lib/projects";
import { loadSessionDetail } from "@/lib/sessions/load";

export const metadata: Metadata = {
  title: "Session",
};

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; sessionId: string }>;
}) {
  const { projectId, sessionId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <EmptyState
        title="Session is not available"
        description="Sign in to see reconstructed room history."
      />
    );
  }

  const membership = await getMembership(session.user.id, projectId);
  if (!membership) {
    return (
      <EmptyState
        title="Session is not available"
        description="You need access to this project to view its session history."
      />
    );
  }

  let livekit = null;
  try {
    livekit = await getProjectLiveKit(session.user.id, projectId);
  } catch {
    livekit = null;
  }

  const payload = await loadSessionDetail(projectId, decodeURIComponent(sessionId), livekit);
  if (!payload) {
    return (
      <EmptyState
        title="Session not found"
        description="LumiVoice only reconstructs sessions from the last 30 days of stored webhooks."
      />
    );
  }

  return <SessionDetailView projectId={projectId} initial={payload} />;
}
