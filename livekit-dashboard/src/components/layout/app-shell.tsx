import type { ReactNode } from "react";
import { LiveStatus } from "@/components/layout/live-status";
import { BrandMark, SidebarNav } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { Separator } from "@/components/ui/separator";
import type { ProjectOption } from "@/lib/projects";

export function AppShell({
  projectId,
  projects,
  userEmail,
  children,
}: {
  projectId: string;
  projects: ProjectOption[];
  userEmail: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:ring-[3px] focus:ring-ring"
      >
        Skip to content
      </a>
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-border bg-panel px-4 py-5 md:flex">
        <BrandMark href={`/dashboard/${projectId}`} />
        <Separator className="my-5" />
        <SidebarNav projectId={projectId} />
        <div className="mt-auto pt-4">
          <LiveStatus projectId={projectId} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar projectId={projectId} projects={projects} userEmail={userEmail} />
        <main id="main-content" className="flex-1 px-4 py-5 md:px-6 md:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
