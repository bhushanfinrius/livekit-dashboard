import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/layout/app-shell";
import { getUserMemberships } from "@/lib/projects";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/dashboard/${projectId}`);
  }

  const memberships = await getUserMemberships(session.user.id);
  if (memberships.length === 0) {
    redirect("/onboarding");
  }

  const current = memberships.find((membership) => membership.project.id === projectId);
  if (!current) {
    redirect(`/dashboard/${memberships[0].project.id}`);
  }

  const projects = memberships.map((membership) => ({
    id: membership.project.id,
    name: membership.project.name,
  }));

  return (
    <AppShell
      projectId={projectId}
      projects={projects}
      userEmail={session.user.email ?? session.user.id}
    >
      {children}
    </AppShell>
  );
}
