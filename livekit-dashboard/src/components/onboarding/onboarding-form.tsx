"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/copy-field";
import { WebhookUrls } from "@/components/webhooks/webhook-urls";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiJson } from "@/lib/api/client";
import { isLocalLiveKitUrl, LOCAL_LIVEKIT } from "@/lib/livekit/local-defaults";

type CreatedProject = {
  id: string;
  name: string;
  joinCode: string;
  livekitApiKey: string;
  livekitApiSecret: string;
};

type LocalKeys = { url: string };

export function OnboardingForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"create" | "join">("create");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"create" | "join" | null>(null);
  const [created, setCreated] = useState<CreatedProject | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string>(LOCAL_LIVEKIT.url);
  const [livekitApiKey, setLivekitApiKey] = useState("");
  const [livekitApiSecret, setLivekitApiSecret] = useState("");

  // The self-hosted server assigns a key pair from its pool; only a remote or Cloud
  // LiveKit still needs credentials pasted in.
  const selfHosted = isLocalLiveKitUrl(livekitUrl);

  useEffect(() => {
    void apiJson<LocalKeys>("/api/livekit/local-keys")
      .then((keys) => setLivekitUrl(keys.url))
      .catch(() => {});
  }, []);

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
        ...(selfHosted ? {} : { livekitApiKey, livekitApiSecret }),
      }),
    });

    let payload: CreatedProject & { error?: string };
    try {
      payload = (await response.json()) as CreatedProject & { error?: string };
    } catch {
      setError("Could not create project (server did not return JSON). Check LiveKit and LumiVoice logs.");
      setPending(null);
      return;
    }
    if (!response.ok) {
      setError(payload.error ?? "Could not create project");
      setPending(null);
      return;
    }

    setCreated(payload);
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
          {selfHosted ? (
            <p className="text-xs text-muted-foreground">
              This project gets its own LiveKit API key, assigned from the pool in{" "}
              <span className="font-mono">livekit.yaml</span>. You will see the key and
              secret once, right after creating.
            </p>
          ) : (
            <>
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
            </>
          )}
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
    </div>
  );
}
