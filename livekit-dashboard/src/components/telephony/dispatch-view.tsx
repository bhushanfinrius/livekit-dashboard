"use client";

import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageSkeleton } from "@/components/page-skeleton";
import { StatTile } from "@/components/stat-tile";
import { CreateDispatchSheet } from "@/components/telephony/create-dispatch-sheet";
import { useSipConfig } from "@/components/telephony/use-sip-config";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiJson } from "@/lib/api/client";

export function DispatchView({ projectId }: { projectId: string }) {
  const { data, error, ready, pending, run } = useSipConfig(projectId);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  if (!ready) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Assign inbound trunks to a room (direct) or a room-name prefix (individual / callee).
        </p>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          + Create new dispatch rule
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <StatTile label="Total dispatch rules" value={String(data.dispatch.length)} />

      {data.dispatch.length === 0 ? (
        <EmptyState
          title="No dispatch rules"
          description="Without a rule, inbound SIP calls have nowhere to land."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-panel-2 text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Dispatch rule ID</th>
                <th className="px-3 py-2 font-medium">Rule name</th>
                <th className="px-3 py-2 font-medium">Rule type</th>
                <th className="px-3 py-2 font-medium">Destination room</th>
                <th className="px-3 py-2 font-medium">Trunks</th>
                <th className="w-10 px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {data.dispatch.map((rule) => (
                <tr key={rule.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{rule.id}</td>
                  <td className="px-3 py-2">{rule.name}</td>
                  <td className="px-3 py-2 capitalize">{rule.type}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {rule.roomName ?? rule.roomPrefix ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {rule.trunkIds.length ? rule.trunkIds.join(", ") : "all"}
                  </td>
                  <td className="px-3 py-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="Rule actions">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setDeleteId(rule.id)}>Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateDispatchSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        pending={pending === "create"}
        onCreate={async (payload) => {
          return run("create", async () => {
            await apiJson(`/api/projects/${projectId}/sip/dispatch`, {
              method: "POST",
              body: JSON.stringify(payload),
            });
          });
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        title="Delete dispatch rule?"
        description="This removes the config from livekit-server. Active calls are not hung up from here."
        confirmLabel="Delete"
        pending={pending === "delete"}
        onConfirm={() => {
          if (!deleteId) return;
          const id = deleteId;
          void run("delete", async () => {
            await apiJson(
              `/api/projects/${projectId}/sip/dispatch/${encodeURIComponent(id)}`,
              { method: "DELETE" },
            );
            setDeleteId(null);
          });
        }}
      />
    </div>
  );
}
