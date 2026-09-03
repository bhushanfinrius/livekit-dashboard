"use client";

import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiJson } from "@/lib/api/client";

export type ApiKeyRow = {
  id: string;
  apiKey: string;
  apiSecret: string | null;
  name: string;
  owner: string;
  issuedAt: string;
  isPrimary: boolean;
};

function issuedLabel(iso: string) {
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
  if (days < 1) return "today";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.max(1, Math.floor(days / 30));
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

type Removal = { key: ApiKeyRow; revoke: boolean };

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
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [created, setCreated] = useState<{ apiKey: string; apiSecret: string } | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);

  const primary = keys.find((key) => key.isPrimary);

  async function run(key: string, work: () => Promise<void>) {
    setPending(key);
    setError(null);
    setMessage(null);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
    } finally {
      setPending(null);
    }
  }

  function createKey() {
    return run("create", async () => {
      const payload = await apiJson<ApiKeyRow & { apiSecret: string }>(
        `/api/projects/${projectId}/keys`,
        { method: "POST", body: JSON.stringify({ name: newName.trim() || undefined }) },
      );
      setKeys((current) => [...current, payload]);
      setNewName("");
      setCreated({ apiKey: payload.apiKey, apiSecret: payload.apiSecret });
    });
  }

  function rotatePrimary() {
    return run("rotate", async () => {
      const payload = await apiJson<ApiKeyRow & { apiSecret: string }>(
        `/api/projects/${projectId}/keys`,
        { method: "POST", body: JSON.stringify({ rotatePrimary: true }) },
      );
      setKeys((current) => current.map((key) => (key.isPrimary ? payload : key)));
      setRotateOpen(false);
      setCreated({ apiKey: payload.apiKey, apiSecret: payload.apiSecret });
    });
  }

  function removeKey({ key, revoke }: Removal) {
    return run("remove", async () => {
      const query = revoke ? "?revoke=true" : "";
      await apiJson(`/api/projects/${projectId}/keys/${key.id}${query}`, { method: "DELETE" });
      setKeys((current) => current.filter((row) => row.id !== key.id));
      setRemoval(null);
      setMessage(
        revoke
          ? `Revoked ${key.apiKey}. LiveKit restarted and no longer accepts it.`
          : `Deleted ${key.apiKey}. It keeps working until LiveKit is recreated.`,
      );
    });
  }

  async function copy(value: string | null) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Keys for this project. The primary is the one LumiVoice uses for Talk, room creation,
        SIP dial and recordings. Create more for your own apps, SDKs and CLI sessions.
      </p>

      {canManage ? (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void createKey();
          }}
        >
          <div className="space-y-1.5 sm:flex-1">
            <Label htmlFor="key-name">Description</Label>
            <Input
              id="key-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="backend service"
            />
          </div>
          <Button type="submit" disabled={pending !== null}>
            {pending === "create" ? "Creating…" : "Create key"}
          </Button>
        </form>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-live">{message}</p> : null}

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
              <tr key={row.id} className="border-t border-border">
                <td className="px-3 py-2.5">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {row.name || "(none)"}
                    {row.isPrimary ? <Badge variant="outline">Primary</Badge> : null}
                  </span>
                </td>
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
                      {canManage && row.isPrimary ? (
                        <DropdownMenuItem onClick={() => setRotateOpen(true)}>
                          Rotate key
                        </DropdownMenuItem>
                      ) : null}
                      {canManage && !row.isPrimary ? (
                        <>
                          <DropdownMenuItem
                            onClick={() => setRemoval({ key: row, revoke: false })}
                          >
                            Delete
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setRemoval({ key: row, revoke: true })}
                          >
                            Revoke now
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManage && primary?.apiSecret ? (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium">Primary credentials</p>
          <p className="text-xs text-muted-foreground">
            Unlike LiveKit Cloud, LumiVoice keeps secrets for owners so you can copy them again.
          </p>
          <CopyField label="API key" value={primary.apiKey} />
          <CopyField label="API secret" value={primary.apiSecret} secret defaultVisible />
        </div>
      ) : null}

      {canManage ? (
        <p className="text-xs text-muted-foreground">
          Creating a key is instant: it claims an unused pair from{" "}
          <span className="font-mono">livekit.yaml</span>, so nothing restarts. Delete also
          leaves LiveKit running, which means the key stays valid until the server is next
          recreated — use Revoke now to cut it off immediately. Revoke and Rotate restart
          LiveKit and only work when LumiVoice runs on the host (
          <span className="font-mono">npm run dev</span>). If the pool runs out, run{" "}
          <span className="font-mono">npm run livekit:keys -- --pool-add 10</span>.
        </p>
      ) : (
        <Badge variant="outline">Only owners can copy secrets or manage keys</Badge>
      )}

      <CreatedKeysDialog
        open={Boolean(created)}
        apiKey={created?.apiKey ?? ""}
        apiSecret={created?.apiSecret ?? ""}
        onClose={() => setCreated(null)}
      />

      <ConfirmDialog
        open={Boolean(removal)}
        onOpenChange={(open) => {
          if (!open) setRemoval(null);
        }}
        title={removal?.revoke ? "Revoke this key now?" : "Delete this key?"}
        description={
          removal?.revoke
            ? "LiveKit will be recreated so the key stops working immediately. Calls in progress are dropped, roughly 30 seconds."
            : "The key is removed from LumiVoice and its pair returns to the pool. LiveKit only reads keys at startup, so the key keeps working until the server is recreated."
        }
        confirmLabel={removal?.revoke ? "Revoke now" : "Delete"}
        pending={pending === "remove"}
        onConfirm={() => {
          if (removal) void removeKey(removal);
        }}
      />

      <ConfirmDialog
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        title="Rotate the primary key?"
        description="A new pair replaces the project's current one and LiveKit is recreated, dropping calls in progress. The deployed agent worker is updated to match."
        confirmLabel="Rotate key"
        pending={pending === "rotate"}
        onConfirm={() => void rotatePrimary()}
      />
    </div>
  );
}
