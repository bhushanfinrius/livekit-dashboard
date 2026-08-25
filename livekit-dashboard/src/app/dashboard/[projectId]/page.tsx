import type { Metadata } from "next";
import { auth } from "@/auth";
import { EmptyState } from "@/components/empty-state";
import { OverviewDashboard } from "@/components/overview/overview-dashboard";
import { loadOverview } from "@/lib/overview/load";
import {
  getProjectLiveKit,
  liveKitErrorMessage,
  ProjectAccessError,
} from "@/lib/livekit";

export const metadata: Metadata = {
  title: "Overview",
};

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <EmptyState
        title="Overview is not available"
        description="Sign in to watch live stats for this LiveKit server."
      />
    );
  }

  try {
    const livekit = await getProjectLiveKit(session.user.id, projectId);
    const overview = await loadOverview(livekit, "24h");
    return <OverviewDashboard projectId={projectId} initial={overview} />;
  } catch (error) {
    if (error instanceof ProjectAccessError) {
      return (
        <EmptyState
          title="Overview is not available"
          description="You need access to this project to view its live stats."
        />
      );
    }
    return (
      <EmptyState
        title="Could not load overview"
        description={liveKitErrorMessage(error)}
      />
    );
  }
}
