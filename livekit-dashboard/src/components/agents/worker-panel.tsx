"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiJson } from "@/lib/api/client";

export type AgentWorkerSnapshot = {
  status: "stopped" | "running" | "restarting";
  agentName: string | null;
  container: string | null;
  entrypoint?: string | null;
};

export function WorkerPanel({
  projectId,
  canManage,
  worker,
  pending,
  onWorker,
  onError,
  onPending,
}: {
  projectId: string;
  canManage: boolean;
  worker: AgentWorkerSnapshot | null;
  pending: string | null;
  onWorker: (worker: AgentWorkerSnapshot) => void;
  onError: (message: string | null) => void;
  onPending: (key: string | null) => void;
}) {
  const [agentName, setAgentName] = useState(worker?.agentName ?? "my-agent");
  const [logs, setLogs] = useState("");

  useEffect(() => {
    if (worker?.agentName) setAgentName(worker.agentName);
  }, [worker?.agentName]);

  const loadLogs = useCallback(async () => {
    if (!canManage) return;
    const payload = await apiJson<{ logs: string }>(`/api/projects/${projectId}/agents/worker/logs`);
    setLogs(payload.logs);
  }, [canManage, projectId]);

  useEffect(() => {
    if (!canManage) return;
    void loadLogs().catch(() => {});
  }, [canManage, loadLogs, worker?.status, worker?.container]);

  if (!canManage) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Worker</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Only project owners can deploy the local Docker agent worker.
        </p>
      </section>
    );
  }

  const busy = Boolean(pending);
  const running = worker?.status === "running" || worker?.status === "restarting";

  async function run(key: string, work: () => Promise<AgentWorkerSnapshot>) {
    onPending(key);
    onError(null);
    try {
      const next = await work();
      onWorker(next);
      await loadLogs().catch(() => {});
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Worker command failed");
    } finally {
      onPending(null);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Worker</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Put STT/TTS/LLM or realtime keys in the starter{" "}
            <span className="font-mono">.env.local</span>, then deploy. LumiVoice copies that whole
            file and overlays this project&apos;s LiveKit URL, API key, and secret.
          </p>
        </div>
        <Badge variant={running ? "default" : "outline"} className="capitalize">
          {pending === "deploy" ? "building" : (worker?.status ?? "stopped")}
        </Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="worker-name">Agent name</Label>
          <Input
            id="worker-name"
            className="font-mono"
            value={agentName}
            onChange={(event) => setAgentName(event.target.value)}
            placeholder="my-agent"
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Container</Label>
          <p className="flex h-9 items-center font-mono text-sm text-muted-foreground">
            {worker?.container ?? "not created"}
          </p>
          {worker?.entrypoint ? (
            <p className="font-mono text-xs text-muted-foreground">{worker.entrypoint}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy || !agentName.trim()}
          onClick={() =>
            void run("deploy", () =>
              apiJson<AgentWorkerSnapshot>(`/api/projects/${projectId}/agents/worker`, {
                method: "POST",
                body: JSON.stringify({ agentName: agentName.trim(), rebuild: true }),
              }),
            )
          }
        >
          {pending === "deploy" ? "Building…" : running ? "Redeploy" : "Deploy worker"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !running}
          onClick={() =>
            void run("restart", () =>
              apiJson<AgentWorkerSnapshot>(`/api/projects/${projectId}/agents/worker`, {
                method: "POST",
                body: JSON.stringify({
                  agentName: agentName.trim() || worker?.agentName,
                  rebuild: false,
                }),
              }),
            )
          }
        >
          {pending === "restart" ? "Restarting…" : "Restart"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || worker?.status === "stopped"}
          onClick={() =>
            void run("stop", () =>
              apiJson<AgentWorkerSnapshot>(`/api/projects/${projectId}/agents/worker`, {
                method: "DELETE",
              }),
            )
          }
        >
          {pending === "stop" ? "Stopping…" : "Stop"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => void loadLogs().catch((caught: unknown) => {
            onError(caught instanceof Error ? caught.message : "Could not load logs");
          })}
        >
          Refresh logs
        </Button>
      </div>

      <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
        {logs.trim() || "No logs yet. Deploy the worker to see LiveKit registration output."}
      </pre>
    </section>
  );
}
