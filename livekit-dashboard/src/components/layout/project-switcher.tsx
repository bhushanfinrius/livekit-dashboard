"use client";

import Link from "next/link";
import { Check, ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectOption } from "@/lib/projects";
import { cn } from "@/lib/utils";

export function ProjectSwitcher({
  projectId,
  projects,
  always = false,
}: {
  projectId: string;
  projects: ProjectOption[];
  always?: boolean;
}) {
  const current = projects.find((project) => project.id === projectId);
  const label = current?.name ?? projectId;

  if (projects.length <= 1) {
    return (
      <span
        className={cn(
          "max-w-[160px] truncate font-mono text-xs text-muted-foreground",
          !always && "hidden sm:inline",
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-8 max-w-[200px] gap-1.5 font-mono text-xs",
            !always && "hidden sm:inline-flex",
            always && "inline-flex w-full max-w-none",
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        {projects.map((project) => (
          <DropdownMenuItem key={project.id} asChild>
            <Link href={`/dashboard/${project.id}`} className="font-mono text-xs">
              <span className="flex-1 truncate">{project.name}</span>
              {project.id === projectId ? <Check className="size-3.5 text-live" /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding?new=1">
            <Plus className="size-3.5" />
            New project
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
