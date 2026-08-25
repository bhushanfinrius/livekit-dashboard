import type { Metadata } from "next";
import { auth } from "@/auth";
import { EgressIngressView } from "@/components/egress/egress-ingress-view";
import { EmptyState } from "@/components/empty-state";
import { recordingOutputError } from "@/lib/egress/recording";
import {
  getProjectLiveKit,
  liveKitErrorMessage,
  ProjectAccessError,
  splitEgressJobs,
  toEgressSnapshot,
  toIngressSnapshot,
} from "@/lib/livekit";

export const metadata: Metadata = {
  title: "Egresses",
};

export const dynamic = "force-dynamic";

export default async function EgressPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <EmptyState
        title="Egress is not available"
        description="Sign in to watch recording jobs on this LiveKit server."
      />
    );
  }

  try {
    const livekit = await getProjectLiveKit(session.user.id, projectId);
    const [egress, ingress] = await Promise.all([
      livekit.egress.list().then((jobs) => splitEgressJobs(jobs.map(toEgressSnapshot))),
      livekit.ingress.list().then((items) => items.map(toIngressSnapshot)),
    ]);
    return (
      <EgressIngressView
        projectId={projectId}
        initialEgress={egress}
        initialIngress={ingress}
        recordingError={recordingOutputError()}
        mode="egress"
      />
    );
  } catch (error) {
    if (error instanceof ProjectAccessError) {
      return (
        <EmptyState
          title="Egress is not available"
          description="You need access to this project to view its recording jobs."
        />
      );
    }
    return (
      <EgressIngressView
        projectId={projectId}
        initialEgress={{ active: [], recent: [] }}
        initialIngress={[]}
        initialError={liveKitErrorMessage(error)}
        mode="egress"
      />
    );
  }
}
