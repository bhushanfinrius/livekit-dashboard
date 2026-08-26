"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/copy-field";
import { CreatedKeysDialog } from "@/components/keys/created-keys-dialog";
import { WebhookUrls } from "@/components/webhooks/webhook-urls";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiJson } from "@/lib/api/client";
import { LOCAL_LIVEKIT } from "@/lib/livekit/local-defaults";

type CreatedProject = {
  id: string;
  name: string;
  joinCode: string;
  livekitApiKey: string;
  livekitApiSecret: string;
};

type LocalKeys = {
  url: string;
  apiKey: string;
  apiSecret: string;
  canRotate?: boolean;
};

export function OnboardingForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"create" | "join">("create");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<"create" | "keys" | "join" | null>(null);
  const [created, setCreated] = useState<CreatedProject | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string>(LOCAL_LIVEKIT.url);
  const [livekitApiKey, setLivekitApiKey] = useState<string>(LOCAL_LIVEKIT.apiKey);
  const [livekitApiSecret, setLivekitApiSecret] = useState<string>(LOCAL_LIVEKIT.apiSecret);
  const [revealKeys, setRevealKeys] = useState(false);
  const [canRotate, setCanRotate] = useState(false);

  useEffect(() => {
    void apiJson<LocalKeys>("/api/livekit/local-keys")
      .then((keys) => {
        setLivekitUrl(keys.url);
        setLivekitApiKey(keys.apiKey);
        setLivekitApiSecret(keys.apiSecret);
        setCanRotate(keys.canRotate === true);
      })
      .catch(() => {});
  }, []);

  async function applyKeys(nextMode: "generate" | "defaults") {
    setPending("keys");
    setError(null);
    setMessage(null);
    try {
      const keys = await apiJson<LocalKeys>("/api/livekit/local-keys", {
        method: "POST",
        body: JSON.stringify({ mode: nextMode }),
      });
      setLivekitUrl(keys.url);
      setLivekitApiKey(keys.apiKey);
      setLivekitApiSecret(keys.apiSecret);
      setRevealKeys(nextMode === "generate");
      setMessage(
        nextMode === "defaults"
          ? "Restored Docker defaults in livekit.yaml and sip.yaml. LiveKit restarted."
          : "Wrote a new key pair to livekit.yaml and sip.yaml. LiveKit restarted. Copy the secret from the dialog.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not apply keys");
    } finally {
      setPending(null);
    }
  }

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("create");
    setError(null);

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        livekitUrl,
        livekitApiKey,
        livekitApiSecret,
      }),
    });

    let payload: CreatedProject & { error?: string };
    try {
      payload = (await response.json()) as CreatedProject & { error?: string };
    } catch {
      setError("Could not create project (server did not return JSON). Check LiveKit and Deck logs.");
      setPending(null);
      return;
    }
    if (!response.ok) {
      setError(payload.error ?? "Could not create project");
      setPending(null);
      return;
    }

    setCreated({
      id: payload.id,
      name: payload.name,
      joinCode: payload.joinCode,
      livekitApiKey,
      livekitApiSecret,
    });
    setPending(null);
  }

  async function joinProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("join");
    setError(null);

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/projects/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ joinCode: form.get("joinCode") }),
    });

    const payload = (await response.json()) as { id?: string; error?: string };
    if (!response.ok || !payload.id) {
      setError(payload.error ?? "Could not join project");
      setPending(null);
      return;
    }

    router.push(`/dashboard/${payload.id}`);
    router.refresh();
  }

  if (created) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{created.name}</span> is
          connected. Teammates can join with this code:
        </p>
        <p className="rounded-md border border-border bg-panel-2 px-3 py-2 font-mono text-lg tracking-[0.3em]">
          {created.joinCode}
        </p>
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">API keys</h2>
          <p className="text-sm text-muted-foreground">
            Copy the secret now. Owners can copy it again later from API keys.
          </p>
          <CopyField label="API key" value={created.livekitApiKey} />
          <CopyField label="API secret" value={created.livekitApiSecret} secret defaultVisible />
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Webhook URL</h2>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            Local compose already uses the shared URL. Copy a project URL if
            LiveKit runs outside Docker.
          </p>
          <WebhookUrls projectId={created.id} />
        </div>
        <Button className="w-full" onClick={() => router.push(`/dashboard/${created.id}`)}>
          Open console
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 rounded-md border border-border p-1">
        <button
          type="button"
          onClick={() => {
            setMode("create");
            setError(null);
          }}
          className={`rounded-sm px-3 py-1.5 text-sm font-medium ${
            mode === "create" ? "bg-accent text-foreground" : "text-muted-foreground"
          }`}
        >
          Create project
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("join");
            setError(null);
          }}
          className={`rounded-sm px-3 py-1.5 text-sm font-medium ${
            mode === "join" ? "bg-accent text-foreground" : "text-muted-foreground"
          }`}
        >
          Join project
        </button>
      </div>

      {mode === "create" ? (
        <form onSubmit={createProject} className="space-y-4" autoComplete="off">
          <div className="space-y-2">
            <Label htmlFor="name">Project name</Label>
            <Input id="name" name="name" required placeholder="production" defaultValue="demo" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {canRotate ? (
                <>
                  Keys are loaded from <span className="font-mono">livekit.yaml</span>. Create
                  the project with those values. Generate is optional: it rewrites YAML and
                  restarts local LiveKit (host Deck only).
                </>
              ) : (
                <>
                  Docker already loaded keys from <span className="font-mono">livekit.yaml</span>.
                  Leave the fields as they are and click Create. Do not type a new key —
                  LiveKit will reject it until the YAML files and containers are updated on the
                  host.
                </>
              )}
            </p>
            {canRotate ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending !== null}
                  onClick={() => void applyKeys("defaults")}
                >
                  {pending === "keys" ? "Applying…" : "Fill Docker defaults"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending !== null}
                  onClick={() => void applyKeys("generate")}
                >
                  {pending === "keys" ? "Applying…" : "Generate key pair"}
                </Button>
              </div>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="livekitUrl">LiveKit URL</Label>
            <Input
              id="livekitUrl"
              name="livekitUrl"
              required
              value={livekitUrl}
              onChange={(event) => setLivekitUrl(event.target.value)}
              autoComplete="off"
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="livekitApiKey">API key</Label>
            <Input
              id="livekitApiKey"
              name="livekitApiKey"
              required
              value={livekitApiKey}
              onChange={(event) => setLivekitApiKey(event.target.value)}
              autoComplete="off"
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="livekitApiSecret">API secret</Label>
            <Input
              id="livekitApiSecret"
              name="livekitApiSecret"
              type="text"
              required
              minLength={32}
              value={livekitApiSecret}
              onChange={(event) => setLivekitApiSecret(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </div>
          {message ? <p className="text-sm text-live">{message}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={pending !== null}>
            {pending === "create" ? "Checking LiveKit…" : "Create and connect"}
          </Button>
        </form>
      ) : (
        <form onSubmit={joinProject} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="joinCode">Join code</Label>
            <Input
              id="joinCode"
              name="joinCode"
              required
              className="font-mono uppercase tracking-[0.2em]"
              placeholder="ABCD2345"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={pending !== null}>
            {pending === "join" ? "Joining…" : "Join project"}
          </Button>
        </form>
      )}
      <CreatedKeysDialog
        open={revealKeys}
        apiKey={livekitApiKey}
        apiSecret={livekitApiSecret}
        onClose={() => setRevealKeys(false)}
      />
    </div>
  );
}
