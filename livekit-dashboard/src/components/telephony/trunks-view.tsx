"use client";

import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageSkeleton } from "@/components/page-skeleton";
import { StatTile } from "@/components/stat-tile";
import {
  CreateTrunkSheet,
  type TrunkDirection,
} from "@/components/telephony/create-trunk-sheet";
import { useSipConfig } from "@/components/telephony/use-sip-config";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiJson } from "@/lib/api/client";
import type { InboundTrunkSnapshot, OutboundTrunkSnapshot } from "@/lib/livekit/sip-types";

type EditTarget = {
  direction: TrunkDirection;
  trunk: InboundTrunkSnapshot | OutboundTrunkSnapshot;
};

export function TrunksView({ projectId }: { projectId: string }) {
  const { data, error, ready, pending, run } = useSipConfig(projectId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setSheetOpen(true);
  }

  function openEdit(target: EditTarget) {
    setEditing(target);
    setSheetOpen(true);
  }

  if (!ready) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Same APIs as <span className="font-mono">lk sip inbound / outbound</span>. Phone numbers
          stay on the trunk — this server has no Cloud DID inventory.
        </p>
        <Button type="button" onClick={openCreate}>
          + Create new trunk
        </Button>
      </div>
      {error && !sheetOpen ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <StatTile label="Total inbound trunks" value={String(data.inbound.length)} />
        <StatTile label="Total outbound trunks" value={String(data.outbound.length)} />
      </div>

      <TrunkSection
        title="Inbound"
        empty="No inbound trunks"
        emptyDescription="Create one to accept calls into LiveKit, then attach it on a dispatch rule."
        addressLabel="Auth"
        rows={data.inbound.map((trunk) => ({
          id: trunk.id,
          name: trunk.name,
          numbers: trunk.numbers.join(", ") || "—",
          extra: trunk.authUsername ? `auth ${trunk.authUsername}` : "open",
          onEdit: () => openEdit({ direction: "inbound", trunk }),
        }))}
        onDelete={setDeleteId}
      />
      <TrunkSection
        title="Outbound"
        empty="No outbound trunks"
        emptyDescription="Create one to dial PSTN numbers from a room."
        addressLabel="Address"
        rows={data.outbound.map((trunk) => ({
          id: trunk.id,
          name: trunk.name,
          numbers: trunk.numbers.join(", ") || "—",
          extra: trunk.address,
          onEdit: () => openEdit({ direction: "outbound", trunk }),
        }))}
        onDelete={setDeleteId}
      />

      <CreateTrunkSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setEditing(null);
        }}
        pending={pending === "save"}
        error={pending === "save" || sheetOpen ? error : null}
        editing={editing}
        onSubmit={async (direction, body) => {
          const isUpdate = Boolean(editing);
          return run("save", async () => {
            if (direction === "inbound") {
              const path = isUpdate
                ? `/api/projects/${projectId}/sip/inbound/${encodeURIComponent(editing!.trunk.id)}`
                : `/api/projects/${projectId}/sip/inbound`;
              await apiJson(path, {
                method: isUpdate ? "PATCH" : "POST",
                body: JSON.stringify(body),
              });
              return;
            }
            const path = isUpdate
              ? `/api/projects/${projectId}/sip/outbound/${encodeURIComponent(editing!.trunk.id)}`
              : `/api/projects/${projectId}/sip/outbound`;
            await apiJson(path, {
              method: isUpdate ? "PATCH" : "POST",
              body: JSON.stringify(body),
            });
          });
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        title="Delete SIP trunk?"
        description="This removes the config from livekit-server. Active calls are not hung up from here."
        confirmLabel="Delete"
        pending={pending === "delete"}
        onConfirm={() => {
          if (!deleteId) return;
          const id = deleteId;
          void run("delete", async () => {
            await apiJson(`/api/projects/${projectId}/sip/trunks/${encodeURIComponent(id)}`, {
              method: "DELETE",
            });
            setDeleteId(null);
          });
        }}
      />
    </div>
  );
}

function TrunkSection({
  title,
  empty,
  emptyDescription,
  addressLabel,
  rows,
  onDelete,
}: {
  title: string;
  empty: string;
  emptyDescription: string;
  addressLabel: string;
  rows: { id: string; name: string; numbers: string; extra: string; onEdit: () => void }[];
  onDelete: (id: string) => void;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">{title}</h2>
      {rows.length === 0 ? (
        <EmptyState className="py-10" title={empty} description={emptyDescription} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-panel-2 text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Trunk ID</th>
                <th className="px-3 py-2 font-medium">Trunk name</th>
                <th className="px-3 py-2 font-medium">Numbers</th>
                <th className="px-3 py-2 font-medium">{addressLabel}</th>
                <th className="w-10 px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-border hover:bg-accent/40"
                  onClick={row.onEdit}
                >
                  <td className="px-3 py-2 font-mono text-xs">{row.id}</td>
                  <td className="px-3 py-2">{row.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.numbers}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{row.extra}</td>
                  <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="Trunk actions">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={row.onEdit}>Edit</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onDelete(row.id)}>Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
