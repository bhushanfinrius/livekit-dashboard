"use client";

import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { CreatedKeysDialog } from "@/components/keys/created-keys-dialog";
import { CopyField } from "@/components/copy-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiJson } from "@/lib/api/client";

export type ApiKeyRow = {
  apiKey: string;
  apiSecret: string | null;
  description: string;
  owner: string;
  issuedAt: string;
};

function issuedLabel(iso: string) {
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
  if (days < 1) return "today";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.max(1, Math.floor(days / 30));
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

export function ApiKeysView({
  projectId,
  canManage,
  initialKeys,
}: {
  projectId: string;
  canManage: boolean;
  initialKeys: ApiKeyRow[];
}) {
  const [keys, setKeys] = useState(initialKeys);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<{ apiKey: string; apiSecret: string } | null>(null);

  async function createKey() {
    setPending(true);
    setError(null);
    try {
      const payload = await apiJson<ApiKeyRow & { apiSecret: string }>(
        `/api/projects/${projectId}/keys`,
        { method: "POST" },
      );
      setKeys([
        {
          apiKey: payload.apiKey,
          apiSecret: payload.apiSecret,
          description: payload.description,
          owner: payload.owner,
          issuedAt: payload.issuedAt,
        },
      ]);
      setCreated({ apiKey: payload.apiKey, apiSecret: payload.apiSecret });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create key");
    } finally {
      setPending(false);
    }
  }

  async function copy(value: string | null) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">Manage project access keys.</p>
        {canManage ? (
          <Button type="button" disabled={pending} onClick={() => void createKey()}>
            {pending ? "Creating…" : "Create key"}
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-panel-2 text-xs tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">API key</th>
              <th className="px-3 py-2 font-medium">Owner</th>
              <th className="px-3 py-2 font-medium">Issued</th>
              <th className="w-10 px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {keys.map((row) => (
              <tr key={row.apiKey} className="border-t border-border">
                <td className="px-3 py-2.5">{row.description || "(none)"}</td>
                <td className="px-3 py-2.5 font-mono text-xs">{row.apiKey}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{row.owner}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{issuedLabel(row.issuedAt)}</td>
                <td className="px-3 py-2.5">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="Key actions">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => void copy(row.apiKey)}>
                        Copy API key
                      </DropdownMenuItem>
                      {row.apiSecret ? (
                        <DropdownMenuItem onClick={() => void copy(row.apiSecret)}>
                          Copy API secret
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem disabled>Secret hidden</DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && keys[0]?.apiSecret ? (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium">Current credentials</p>
          <p className="text-xs text-muted-foreground">
            Unlike LiveKit Cloud, Deck keeps the secret for owners so you can copy it again.
          </p>
          <CopyField label="API key" value={keys[0].apiKey} />
          <CopyField label="API secret" value={keys[0].apiSecret} secret defaultVisible />
        </div>
      ) : null}
      {canManage ? (
        <p className="text-xs text-muted-foreground">
          Create key writes a new pair into <span className="font-mono">livekit.yaml</span>, restarts
          local LiveKit, and stores it on this project. Owners can copy the secret anytime — it is
          not discarded after the dialog closes.
        </p>
      ) : (
        <Badge variant="outline">Only owners can copy the secret</Badge>
      )}

      <CreatedKeysDialog
        open={Boolean(created)}
        apiKey={created?.apiKey ?? ""}
        apiSecret={created?.apiSecret ?? ""}
        onClose={() => setCreated(null)}
      />
    </div>
  );
}
