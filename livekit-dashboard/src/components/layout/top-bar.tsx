"use client";

import { PanelLeft } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LiveStatus } from "@/components/layout/live-status";
import { BrandMark, SidebarNav } from "@/components/layout/sidebar";
import { ProjectSwitcher } from "@/components/layout/project-switcher";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { getPageMeta } from "@/lib/nav";
import type { ProjectOption } from "@/lib/projects";

export function TopBar({
  projectId,
  projects,
  userEmail,
}: {
  projectId: string;
  projects: ProjectOption[];
  userEmail: string;
}) {
  const pathname = usePathname();
  const { title, subtitle } = getPageMeta(pathname);
  const [open, setOpen] = useState(false);

  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-background px-4 py-4 md:px-6">
      <div className="flex min-w-0 items-start gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="mt-0.5 md:hidden"
          aria-label="Open navigation"
          onClick={() => setOpen(true)}
        >
          <PanelLeft />
        </Button>
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold tracking-tight">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ProjectSwitcher projectId={projectId} projects={projects} />
        <UserMenu email={userEmail} />
        <ThemeToggle />
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[220px] bg-panel p-0 sm:max-w-[220px]">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <div className="flex h-full flex-col px-4 py-5">
            <BrandMark href={`/dashboard/${projectId}`} />
            <Separator className="my-5" />
            <SidebarNav projectId={projectId} onNavigate={() => setOpen(false)} />
            <div className="mt-auto space-y-3 pt-4">
              <ProjectSwitcher projectId={projectId} projects={projects} always />
              <UserMenu email={userEmail} always />
              <LiveStatus projectId={projectId} />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
