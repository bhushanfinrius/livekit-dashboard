"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { AreaChart } from "@tremor/react";
import { ChevronDown, Cloud, MoreHorizontal, Plus, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageSkeleton } from "@/components/page-skeleton";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiJson } from "@/lib/api/client";
import { DEFAULT_AGENT_NAME } from "@/lib/livekit/deploy-commands";
import type { OutboundTrunkSnapshot } from "@/lib/livekit/sip-types";
import type { OverviewPayload } from "@/lib/overview/types";

const MeetSession = dynamic(
  () => import("@/components/console/meet-session").then((mod) => mod.MeetSession),
  { ssr: false },
);

export type AgentWorkerSnapshot = {
  status: "stopped" | "running" | "restarting";
  health?: "stopped" | "starting" | "registered" | "crash_loop" | "unhealthy";
  agentName: string | null;
  container: string | null;
  entrypoint?: string | null;
  workerId?: string | null;
  lastError?: string | null;
  backendBaseUrl?: string | null;
  backendWebhookUrl?: string | null;
  skipCreditCheck?: boolean;
};

type AgentSession = {
  roomName: string;
  agents: { identity: string }[];
};

type ConsoleSession = {
  token: string;
  wsUrl: string;
  roomName: string;
  loopback: boolean;
  agentName: string | null;
};

function deployedCount(worker: AgentWorkerSnapshot | null) {
  if (!worker?.agentName && !worker?.container) return 0;
  return 1;
}

function isLive(worker: AgentWorkerSnapshot | null) {
  return worker?.status === "running" || worker?.status === "restarting";
}

function healthLabel(worker: AgentWorkerSnapshot | null) {
  return worker?.health ?? (isLive(worker) ? "starting" : "stopped");
}

export function AgentsView({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [worker, setWorker] = useState<AgentWorkerSnapshot | null>(null);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [deployOpen, setDeployOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState("");
  const [agentName, setAgentName] = useState(DEFAULT_AGENT_NAME);
  const [entrypoint, setEntrypoint] = useState("src/agant.py");
  const [backendBaseUrl, setBackendBaseUrl] = useState("https://uat-api.solvox.ai");
  const [backendWebhookUrl, setBackendWebhookUrl] = useState(
    "https://uat-api.solvox.ai/api/webhook/call-event",
  );
  const [skipCreditCheck, setSkipCreditCheck] = useState(true);
  const [stopOpen, setStopOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [talk, setTalk] = useState<ConsoleSession | null>(null);
  const dispatchedRooms = useRef(new Set<string>());
  const [testOpen, setTestOpen] = useState(false);
  const [trunks, setTrunks] = useState<OutboundTrunkSnapshot[]>([]);
  const [trunkId, setTrunkId] = useState("");
  const [dialNumber, setDialNumber] = useState("");

  const applyWorker = useCallback((next: AgentWorkerSnapshot) => {
    setWorker(next);
    if (next.agentName) setAgentName(next.agentName);
    if (next.entrypoint) setEntrypoint(next.entrypoint);
    if (next.backendBaseUrl) setBackendBaseUrl(next.backendBaseUrl);
    if (next.backendWebhookUrl) setBackendWebhookUrl(next.backendWebhookUrl);
    if (typeof next.skipCreditCheck === "boolean") setSkipCreditCheck(next.skipCreditCheck);
  }, []);

  const load = useCallback(async () => {
    const [sessionPayload, overviewPayload] = await Promise.all([
      apiJson<{ sessions: AgentSession[] }>(`/api/projects/${projectId}/agents`),
      apiJson<OverviewPayload>(`/api/projects/${projectId}/overview?range=7d`),
    ]);
    setSessions(sessionPayload.sessions);
    setOverview(overviewPayload);
    if (canManage) {
      const next = await apiJson<AgentWorkerSnapshot>(
        `/api/projects/${projectId}/agents/worker`,
      );
      applyWorker(next);
    }
    setError(null);
  }, [applyWorker, canManage, projectId]);

  useEffect(() => {
    void load()
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Could not load agents");
      })
      .finally(() => setReady(true));
  }, [load]);

  useEffect(() => {
    if (!autoRefresh || talk) return;
    const poll = window.setInterval(() => {
      void load().catch(() => {});
    }, 8000);
    return () => window.clearInterval(poll);
  }, [autoRefresh, load, talk]);

  async function runWorker(key: string, body: RequestInit) {
    setPending(key);
    setError(null);
    try {
      const next = await apiJson<AgentWorkerSnapshot>(
        `/api/projects/${projectId}/agents/worker`,
        body,
      );
      applyWorker(next);
      setDeployOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Worker command failed");
    } finally {
      setPending(null);
    }
  }

  async function loadLogs() {
    const payload = await apiJson<{ logs: string }>(
      `/api/projects/${projectId}/agents/worker/logs`,
    );
    setLogs(payload.logs);
  }

  async function dispatchTalkAgent(session: ConsoleSession) {
    const name = session.agentName?.trim();
    if (!name || dispatchedRooms.current.has(session.roomName)) return;
    dispatchedRooms.current.add(session.roomName);
    try {
      await apiJson(`/api/projects/${projectId}/agents/dispatch`, {
        method: "POST",
        body: JSON.stringify({
          roomName: session.roomName,
          agentName: name,
          metadata: JSON.stringify({ mode: "console", call_type: "inbound" }),
        }),
      });
    } catch (caught) {
      dispatchedRooms.current.delete(session.roomName);
      setError(caught instanceof Error ? caught.message : "Could not dispatch agent");
    }
  }

  async function startTalk() {
    setPending("talk");
    setError(null);
    try {
      const payload = await apiJson<ConsoleSession>(`/api/projects/${projectId}/console`, {
        method: "POST",
        body: JSON.stringify({
          dispatchAgent: true,
          agentName: worker?.agentName ?? agentName,
        }),
      });
      setTalk(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start Talk");
    } finally {
      setPending(null);
    }
  }

  async function openTestCall() {
    setTestOpen(true);
    setError(null);
    try {
      const payload = await apiJson<{ outbound: OutboundTrunkSnapshot[] }>(
        `/api/projects/${projectId}/sip`,
      );
      setTrunks(payload.outbound);
      if (!trunkId && payload.outbound[0]) setTrunkId(payload.outbound[0].id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load SIP trunks");
    }
  }

  async function placeTestCall() {
    setPending("dial");
    setError(null);
    try {
      const roomName = `deck-call-${Math.random().toString(36).slice(2, 8)}`;
      const name = worker?.agentName ?? agentName;
      await apiJson(`/api/projects/${projectId}/agents/dispatch`, {
        method: "POST",
        body: JSON.stringify({
          roomName,
          agentName: name,
          metadata: JSON.stringify({ mode: "test-call" }),
        }),
      });
      await apiJson(`/api/projects/${projectId}/sip/dial`, {
        method: "POST",
        body: JSON.stringify({
          sipTrunkId: trunkId,
          number: dialNumber.trim(),
          roomName,
        }),
      });
      setTestOpen(false);
      setDialNumber("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Test call failed");
    } finally {
      setPending(null);
    }
  }

  const concurrent = useMemo(
    () => sessions.reduce((sum, session) => sum + session.agents.length, 0),
    [sessions],
  );

  const chartData = useMemo(() => {
    const sessionsSeries = overview?.agents.concurrent ?? overview?.rooms.sessionCounts ?? [];
    return sessionsSeries.map((point, index) => ({
      date: point.date,
      Sessions: point.value,
      Errors: 0,
      _i: index,
    }));
  }, [overview]);

  if (!ready) return <PageSkeleton />;

  const deployed = deployedCount(worker);
  const minutes = Math.round(overview?.agents.minutes ?? 0);
  const health = healthLabel(worker);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAutoRefresh((value) => !value)}
        >
          <RefreshCw className="size-3.5" />
          Auto-refresh {autoRefresh ? "on" : "off"}
        </Button>
        {canManage ? (
          <Button type="button" size="sm" onClick={() => setDeployOpen(true)}>
            <Plus className="size-3.5" />
            Deploy new agent
            <ChevronDown className="size-3.5 opacity-70" />
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Agents deployed" value={String(deployed)} />
        <Metric label="Concurrent agent sessions" value={String(concurrent)} />
        <Metric
          label="Agent session minutes this billing period"
          value={`${minutes.toLocaleString()} min`}
        />
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium tracking-wide uppercase">Agent sessions served</h2>
          <p className="text-xs text-muted-foreground">Past 7 days</p>
        </div>
        <AreaChart
          className="mt-4 h-64"
          data={chartData}
          index="date"
          categories={["Sessions", "Errors"]}
          colors={["blue", "rose"]}
          valueFormatter={(value) => String(Math.round(value))}
          showAnimation={false}
          autoMinValue
          curveType="monotone"
          noDataText="No agent sessions in this window yet"
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Your agents</h2>
        {deployed === 0 ? (
          <p className="text-sm text-muted-foreground">
            No agents deployed yet. Use Deploy new agent to build the starter onto this LiveKit
            server.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <article className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <Cloud className="mt-0.5 size-5 text-muted-foreground" />
                  <div className="min-w-0">
                    <h3 className="truncate font-medium">{worker?.agentName ?? "agent"}</h3>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {worker?.workerId ?? worker?.container ?? "local"}
                    </p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {worker?.entrypoint ?? "src/agant.py"}
                    </p>
                  </div>
                </div>
                {canManage ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="icon-xs" variant="ghost" aria-label="Agent actions">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={Boolean(pending)}
                        onClick={() => setDeployOpen(true)}
                      >
                        Redeploy
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={Boolean(pending) || !isLive(worker)}
                        onClick={() =>
                          void runWorker("restart", {
                            method: "POST",
                            body: JSON.stringify({
                              agentName: worker?.agentName ?? agentName,
                              entrypoint,
                              backendBaseUrl,
                              backendWebhookUrl,
                              skipCreditCheck,
                              rebuild: false,
                            }),
                          })
                        }
                      >
                        Restart
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setLogsOpen(true);
                          void loadLogs().catch((caught: unknown) => {
                            setError(caught instanceof Error ? caught.message : "Could not load logs");
                          });
                        }}
                      >
                        View logs
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={worker?.status === "stopped"}
                        onClick={() => setStopOpen(true)}
                      >
                        Stop
                      </DropdownMenuItem>
                      {worker?.status === "stopped" ? (
                        <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                          Delete
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    health === "registered"
                      ? "secondary"
                      : health === "crash_loop" || health === "unhealthy"
                        ? "destructive"
                        : "outline"
                  }
                >
                  {health.replace("_", " ")}
                </Badge>
                {canManage && isLive(worker) ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      disabled={Boolean(pending)}
                      onClick={() => void startTalk()}
                    >
                      {pending === "talk" ? "Connecting…" : "Talk"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={Boolean(pending)}
                      onClick={() => void openTestCall()}
                    >
                      Test call
                    </Button>
                  </>
                ) : null}
              </div>
              {worker?.lastError && (health === "crash_loop" || health === "unhealthy") ? (
                <p className="mt-3 truncate font-mono text-xs text-destructive" title={worker.lastError}>
                  {worker.lastError}
                </p>
              ) : null}
              <dl className="mt-6 grid grid-cols-2 gap-4 text-xs">
                <div>
                  <dt className="text-muted-foreground tracking-wide uppercase">
                    Concurrent sessions
                  </dt>
                  <dd className="mt-1 font-mono text-sm">{concurrent}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground tracking-wide uppercase">Region</dt>
                  <dd className="mt-1 font-mono text-sm">local</dd>
                </div>
              </dl>
            </article>
          </div>
        )}
      </section>

      <Sheet open={deployOpen} onOpenChange={setDeployOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Deploy new agent</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Builds the starter at <span className="font-mono">AGENT_BUILD_CONTEXT</span> using
              the full <span className="font-mono">.env.local</span>, then overlays LiveKit keys
              and the fields below.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="deploy-name">Agent name</Label>
              <Input
                id="deploy-name"
                className="font-mono"
                value={agentName}
                onChange={(event) => setAgentName(event.target.value)}
                placeholder={DEFAULT_AGENT_NAME}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deploy-entrypoint">Entrypoint</Label>
              <Input
                id="deploy-entrypoint"
                className="font-mono"
                value={entrypoint}
                onChange={(event) => setEntrypoint(event.target.value)}
                placeholder="src/agant.py"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deploy-base">Backend base URL</Label>
              <Input
                id="deploy-base"
                className="font-mono"
                value={backendBaseUrl}
                onChange={(event) => setBackendBaseUrl(event.target.value)}
                placeholder="https://uat-api.solvox.ai"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deploy-webhook">Webhook URL</Label>
              <Input
                id="deploy-webhook"
                className="font-mono"
                value={backendWebhookUrl}
                onChange={(event) => setBackendWebhookUrl(event.target.value)}
                placeholder="https://uat-api.solvox.ai/api/webhook/call-event"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={skipCreditCheck}
                onChange={(event) => setSkipCreditCheck(event.target.checked)}
              />
              Skip credit check
            </label>
            <Button
              type="button"
              className="w-full"
              disabled={!canManage || Boolean(pending) || !agentName.trim()}
              onClick={() =>
                void runWorker("deploy", {
                  method: "POST",
                  body: JSON.stringify({
                    agentName: agentName.trim(),
                    entrypoint: entrypoint.trim() || "src/agant.py",
                    backendBaseUrl: backendBaseUrl.trim(),
                    backendWebhookUrl: backendWebhookUrl.trim(),
                    skipCreditCheck,
                    rebuild: true,
                  }),
                })
              }
            >
              {pending === "deploy" ? "Building…" : "Deploy"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(talk)} onOpenChange={(open) => !open && setTalk(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-4xl">
          <SheetHeader>
            <SheetTitle>Talk · {talk?.roomName ?? "console"}</SheetTitle>
          </SheetHeader>
          {talk?.loopback ? (
            <p className="mt-3 text-sm text-muted-foreground">
              This session uses a local LiveKit URL. Phones and other devices need the public{" "}
              <span className="font-mono">wss://</span> URL in Settings.
            </p>
          ) : null}
          <div className="mt-4">
            {talk ? (
              <MeetSession
                token={talk.token}
                serverUrl={talk.wsUrl}
                audioOnly
                onConnected={() => void dispatchTalkAgent(talk)}
                onLeave={() => setTalk(null)}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={testOpen} onOpenChange={setTestOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Test call</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            {trunks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Create an outbound SIP trunk on{" "}
                <Link
                  href={`/dashboard/${projectId}/telephony/trunks`}
                  className="text-live underline-offset-4 hover:underline"
                >
                  Telephony
                </Link>{" "}
                first.
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="test-trunk">Outbound trunk</Label>
                  <select
                    id="test-trunk"
                    className="native-select h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                    value={trunkId}
                    onChange={(event) => setTrunkId(event.target.value)}
                  >
                    {trunks.map((trunk) => (
                      <option key={trunk.id} value={trunk.id}>
                        {trunk.name || trunk.id}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="test-number">Number</Label>
                  <Input
                    id="test-number"
                    className="font-mono"
                    value={dialNumber}
                    onChange={(event) => setDialNumber(event.target.value)}
                    placeholder="+9198…"
                  />
                </div>
                <Button
                  type="button"
                  className="w-full"
                  disabled={!trunkId || !dialNumber.trim() || Boolean(pending)}
                  onClick={() => void placeTestCall()}
                >
                  {pending === "dial" ? "Dialing…" : "Call"}
                </Button>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={logsOpen} onOpenChange={setLogsOpen}>
        <SheetContent className="sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Worker logs</SheetTitle>
          </SheetHeader>
          <pre className="mt-4 max-h-[70vh] overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
            {logs.trim() || "No logs yet."}
          </pre>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={stopOpen}
        onOpenChange={setStopOpen}
        title="Stop this agent?"
        description="The worker container will stop. SIP and room dispatch will not get this agent until you deploy again."
        confirmLabel="Stop"
        pending={pending === "stop"}
        onConfirm={() => {
          void runWorker("stop", { method: "DELETE" }).then(() => setStopOpen(false));
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this agent?"
        description="Removes the worker container and deploy overlay. You can deploy again later."
        confirmLabel="Delete"
        pending={pending === "delete"}
        onConfirm={() => {
          void runWorker("delete", {
            method: "DELETE",
            body: JSON.stringify({ purge: true }),
          }).then(() => setDeleteOpen(false));
        }}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-3 font-mono text-3xl font-medium tabular-nums tracking-tight">{value}</p>
    </div>
  );
}
