"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyField } from "@/components/copy-field";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiJson } from "@/lib/api/client";
import type { LiveWebhookEvent } from "@/lib/events/types";
import { formatWhen } from "@/lib/format";
import { EGRESS_LIVE_EVENTS } from "@/lib/livekit/egress-types";
import type { EgressSnapshot, IngressSnapshot } from "@/lib/livekit/egress-types";

type EgressPayload = {
  active: EgressSnapshot[];
  recent: EgressSnapshot[];
  recordingError?: string | null;
};

export function EgressIngressView({
  projectId,
  initialEgress,
  initialIngress,
  initialError = null,
  recordingError = null,
  mode = "all",
}: {
  projectId: string;
  initialEgress: EgressPayload;
  initialIngress: IngressSnapshot[];
  initialError?: string | null;
  recordingError?: string | null;
  mode?: "all" | "egress" | "ingress";
}) {
  const [egress, setEgress] = useState(initialEgress);
  const [ingress, setIngress] = useState(initialIngress);
  const [error, setError] = useState<string | null>(initialError);
  const [gcsError, setGcsError] = useState<string | null>(
    recordingError ?? initialEgress.recordingError ?? null,
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [stopTarget, setStopTarget] = useState<EgressSnapshot | null>(null);
  const [recordRoom, setRecordRoom] = useState("");
  const [ingressType, setIngressType] = useState<"RTMP" | "WHIP">("RTMP");
  const [ingressRoom, setIngressRoom] = useState("");
  const [ingressName, setIngressName] = useState("");
  const [createdIngress, setCreatedIngress] = useState<IngressSnapshot | null>(null);

  const load = useCallback(async () => {
    const [jobs, endpoints] = await Promise.all([
      apiJson<EgressPayload>(`/api/projects/${projectId}/egress`),
      apiJson<{ ingress: IngressSnapshot[] }>(`/api/projects/${projectId}/ingress`),
    ]);
    setEgress(jobs);
    setIngress(endpoints.ingress);
    setGcsError(jobs.recordingError ?? null);
    setError(null);
  }, [projectId]);

  useEffect(() => {
    const poll = window.setInterval(() => {
      void load().catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Could not load jobs");
      });
    }, 5000);
    return () => window.clearInterval(poll);
  }, [load]);

  useEffect(() => {
    const source = new EventSource(`/api/projects/${projectId}/events/stream`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as LiveWebhookEvent;
      if (!EGRESS_LIVE_EVENTS.has(event.eventType)) return;
      void load().catch(() => {});
    };
    return () => source.close();
  }, [load, projectId]);

  async function startRecording() {
    setPendingId("record");
    setError(null);
    try {
      await apiJson(`/api/projects/${projectId}/egress`, {
        method: "POST",
        body: JSON.stringify({ roomName: recordRoom.trim(), audioOnly: true }),
      });
      setRecordRoom("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start recording");
    } finally {
      setPendingId(null);
    }
  }

  async function createIngress() {
    setPendingId("ingress");
    setError(null);
    try {
      const payload = await apiJson<{ ingress: IngressSnapshot }>(
        `/api/projects/${projectId}/ingress`,
        {
          method: "POST",
          body: JSON.stringify({
            inputType: ingressType,
            roomName: ingressRoom.trim(),
            name: ingressName.trim() || undefined,
          }),
        },
      );
      setCreatedIngress(payload.ingress);
      setIngressRoom("");
      setIngressName("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create ingress");
    } finally {
      setPendingId(null);
    }
  }

  async function stopJob(job: EgressSnapshot) {
    setPendingId(job.id);
    setError(null);
    try {
      await apiJson(`/api/projects/${projectId}/egress/${encodeURIComponent(job.id)}/stop`, {
        method: "POST",
      });
      setStopTarget(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not stop egress");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        Same APIs as <span className="font-mono">lk egress</span> /{" "}
        <span className="font-mono">lk ingress</span>. Listing and stop talk to
        livekit-server. Deck starts an audio recording for every Talk, SIP, and
        joined room. The <span className="font-mono">livekit-egress</span> worker
        must be running and GCS credentials must be set.
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {gcsError ? <p className="text-sm text-destructive">{gcsError}</p> : null}

      {mode !== "ingress" ? (
        <>
          <section className="space-y-3 rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-medium">Start recording</h2>
            <p className="text-sm text-muted-foreground">
              Audio-only room composite to GCS. The room must be live and{" "}
              <span className="font-mono">livekit-egress</span> must be running.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="record-room">Room name</Label>
                <Input
                  id="record-room"
                  className="font-mono"
                  value={recordRoom}
                  onChange={(event) => setRecordRoom(event.target.value)}
                  placeholder="support"
                />
              </div>
              <Button
                type="button"
                disabled={!recordRoom.trim() || pendingId === "record"}
                onClick={() => void startRecording()}
              >
                {pendingId === "record" ? "Starting…" : "Start recording"}
              </Button>
            </div>
          </section>

          <JobTable
            title="Active egress"
            emptyTitle="No active egress jobs"
            emptyDescription="Deck starts a recording when a room starts. If this stays empty, livekit-egress is down or GCS credentials are missing."
            jobs={egress.active}
            pendingId={pendingId}
            onStop={setStopTarget}
          />

          <JobTable
            title="Recent egress"
            emptyTitle="No recent egress jobs"
            emptyDescription="Completed, failed, and aborted jobs from this LiveKit server appear here."
            jobs={egress.recent}
          />
        </>
      ) : null}

      {mode !== "egress" ? (
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Ingress</h2>
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            Create an RTMP or WHIP ingest endpoint for a room. Copy the URL and stream key into
            OBS or another encoder.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ingress-type">Input</Label>
              <select
                id="ingress-type"
                className="native-select h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                value={ingressType}
                onChange={(event) => setIngressType(event.target.value as "RTMP" | "WHIP")}
              >
                <option value="RTMP">RTMP</option>
                <option value="WHIP">WHIP</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ingress-name">Name (optional)</Label>
              <Input
                id="ingress-name"
                value={ingressName}
                onChange={(event) => setIngressName(event.target.value)}
                placeholder="obs-main"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ingress-room">Room</Label>
              <Input
                id="ingress-room"
                className="font-mono"
                value={ingressRoom}
                onChange={(event) => setIngressRoom(event.target.value)}
                placeholder="stream-room"
              />
            </div>
          </div>
          <Button
            type="button"
            disabled={!ingressRoom.trim() || pendingId === "ingress"}
            onClick={() => void createIngress()}
          >
            {pendingId === "ingress" ? "Creating…" : "Create ingress"}
          </Button>
          {createdIngress ? (
            <div className="space-y-2">
              <CopyField label="URL" value={createdIngress.url} />
              {createdIngress.streamKey ? (
                <CopyField label="Stream key" value={createdIngress.streamKey} secret />
              ) : null}
            </div>
          ) : null}
        </div>
        {ingress.length === 0 ? (
          <EmptyState
            title="No ingress endpoints"
            description="Configured RTMP, WHIP, or URL ingress endpoints on this LiveKit server will list here."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-panel-2 text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Room</th>
                  <th className="px-3 py-2 font-medium">Input</th>
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium">URL</th>
                </tr>
              </thead>
              <tbody>
                {ingress.map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs" title={item.id}>
                      {shortId(item.id)}
                    </td>
                    <td className="px-3 py-2">{item.name || "—"}</td>
                    <td className="px-3 py-2 font-mono">{item.roomName || "—"}</td>
                    <td className="px-3 py-2">{item.inputType}</td>
                    <td className="px-3 py-2">
                      <StatusBadge label={item.state} live={item.state === "publishing"} />
                      {item.error ? (
                        <p className="mt-1 max-w-[240px] truncate text-xs text-destructive" title={item.error}>
                          {item.error}
                        </p>
                      ) : null}
                    </td>
                    <td className="max-w-[280px] truncate px-3 py-2 font-mono text-xs text-muted-foreground" title={item.url}>
                      {item.url || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      ) : null}

      <ConfirmDialog
        open={Boolean(stopTarget)}
        onOpenChange={(open) => {
          if (!open) setStopTarget(null);
        }}
        title="Stop this egress job?"
        description={
          stopTarget
            ? `This stops ${stopTarget.type} egress ${shortId(stopTarget.id)} for room ${stopTarget.roomName || "(unknown)"}.`
            : ""
        }
        confirmLabel="Stop egress"
        pending={Boolean(pendingId)}
        onConfirm={() => {
          if (stopTarget) void stopJob(stopTarget);
        }}
      />
    </div>
  );
}

function JobTable({
  title,
  emptyTitle,
  emptyDescription,
  jobs,
  pendingId,
  onStop,
}: {
  title: string;
  emptyTitle: string;
  emptyDescription: string;
  jobs: EgressSnapshot[];
  pendingId?: string | null;
  onStop?: (job: EgressSnapshot) => void;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">{title}</h2>
      {jobs.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="bg-panel-2 text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Room</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Started</th>
                <th className="px-3 py-2 font-medium">Ended</th>
                <th className="px-3 py-2 font-medium">Output</th>
                {onStop ? <th className="px-3 py-2 font-medium" /> : null}
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs" title={job.id}>
                    {shortId(job.id)}
                  </td>
                  <td className="px-3 py-2 font-mono">{job.roomName || "—"}</td>
                  <td className="px-3 py-2">{job.type}</td>
                  <td className="px-3 py-2">
                    <StatusBadge
                      label={job.status}
                      live={job.active}
                      failed={job.status === "failed" || job.status === "aborted"}
                    />
                    {job.error ? (
                      <p className="mt-1 max-w-[220px] truncate text-xs text-destructive" title={job.error}>
                        {job.error}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {job.startedAt ? formatWhen(job.startedAt) : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {job.endedAt ? formatWhen(job.endedAt) : "—"}
                  </td>
                  <td
                    className="max-w-[240px] truncate px-3 py-2 font-mono text-xs text-muted-foreground"
                    title={job.output ?? undefined}
                  >
                    {job.output || "—"}
                  </td>
                  {onStop ? (
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={pendingId === job.id}
                        onClick={() => onStop(job)}
                      >
                        Stop
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatusBadge({
  label,
  live = false,
  failed = false,
}: {
  label: string;
  live?: boolean;
  failed?: boolean;
}) {
  return (
    <Badge
      variant={failed ? "destructive" : live ? "secondary" : "outline"}
      className={live ? "text-live" : undefined}
    >
      {label}
    </Badge>
  );
}

function shortId(id: string) {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…`;
}
