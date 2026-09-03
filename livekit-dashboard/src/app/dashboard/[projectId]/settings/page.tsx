import type { Metadata } from "next";
import { auth } from "@/auth";
import { EmptyState } from "@/components/empty-state";
import { SettingsView } from "@/components/settings/settings-view";
import { sipUriForProject } from "@/lib/livekit/sip-uri";
import { getMembership, listProjectMembers } from "@/lib/projects";

export const metadata: Metadata = {
  title: "Settings",
};

export const dynamic = "force-dynamic";

export default async function SettingsPage({
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
        title="Project settings are not available"
        description="You need access to this project to change its settings."
      />
    );
  }

  const members = await listProjectMembers(projectId);

  return (
    <SettingsView
      projectId={projectId}
      initialName={membership.project.name}
      initialUrl={membership.project.livekitUrl}
      initialPublicUrl={membership.project.publicLivekitUrl ?? ""}
      initialApiKey={membership.project.livekitApiKey}
      sipUri={sipUriForProject(membership.project)}
      joinCode={membership.project.joinCode}
      role={membership.role}
      initialMembers={members}
      userId={session.user.id}
    />
  );
}
