import type { Metadata } from "next";
import { auth } from "@/auth";
import { EventsFeed } from "@/components/events/events-feed";
import { EmptyState } from "@/components/empty-state";
import { listWebhookEvents } from "@/lib/events/store";
import { getMembership } from "@/lib/projects";

export const metadata: Metadata = {
  title: "Events",
};

export const dynamic = "force-dynamic";

export default async function EventsPage({
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
        title="Events are not available"
        description="You need access to this project to view its webhook log."
      />
    );
  }

  const initial = await listWebhookEvents(projectId, {
    range: "all",
    page: 1,
    pageSize: 50,
  });

  return <EventsFeed projectId={projectId} initial={initial} />;
}
