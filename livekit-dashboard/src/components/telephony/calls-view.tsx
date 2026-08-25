"use client";

import { ChevronDown, Clock } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { PageSkeleton, StatusLine } from "@/components/page-skeleton";
import { StatTile } from "@/components/stat-tile";
import { Field } from "@/components/telephony/field";
import { useSipConfig } from "@/components/telephony/use-sip-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { apiJson } from "@/lib/api/client";
import type { LiveWebhookEvent } from "@/lib/events/types";
import { formatDuration, formatWhen } from "@/lib/format";
import {
  OVERVIEW_RANGE_LABELS,
  OVERVIEW_RANGES,
  type OverviewRange,
} from "@/lib/overview/types";
import type { SipCallsPayload } from "@/lib/telephony/types";

export function CallsView({
  projectId,
  initial,
}: {
  projectId: string;
  initial: SipCallsPayload;
}) {
  const sip = useSipConfig(projectId);
  const [data, setData] = useState(initial);
  const [range, setRange] = useState<OverviewRange>(initial.range);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const load = useCallback(
    async (nextRange: OverviewRange, silent = false) => {
      if (!silent) setLoading(true);
      try {
        const payload = await apiJson<SipCallsPayload>(
          `/api/projects/${projectId}/sip/calls?range=${nextRange}`,
        );
        setData(payload);
        setError(null);
      } catch (caught) {
        if (!silent) {
          setError(caught instanceof Error ? caught.message : "Could not load calls");
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    const poll = window.setInterval(() => {
      void load(rangeRef.current, true);
    }, 10_000);
    return () => window.clearInterval(poll);
  }, [load]);

  useEffect(() => {
    const source = new EventSource(`/api/projects/${projectId}/events/stream`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as LiveWebhookEvent;
      if (!event.eventType.includes("participant_")) return;
      void load(rangeRef.current, true);
    };
    return () => source.close();
  }, [load, projectId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          SIP calls are reconstructed from join/leave webhooks. From/to come from SIP attributes
          when LiveKit includes them.
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Clock />
              {OVERVIEW_RANGE_LABELS[range]}
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {OVERVIEW_RANGES.map((option) => (
              <DropdownMenuItem
                key={option}
                onClick={() => {
                  setRange(option);
                  void load(option);
                }}
              >
                {OVERVIEW_RANGE_LABELS[option]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <StatusLine error={error ?? sip.error} loading={loading} />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Total calls" value={String(data.totalCalls)} live={data.liveCalls > 0} />
        <StatTile label="Total call duration" value={formatDuration(data.totalDurationSeconds)} />
        <StatTile label="Average call duration" value={formatDuration(data.averageDurationSeconds)} />
      </div>

      {sip.ready ? (
        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">Dial out</h2>
          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void sip.run("dial", async () => {
                await apiJson(`/api/projects/${projectId}/sip/dial`, {
                  method: "POST",
                  body: JSON.stringify({
                    sipTrunkId: form.get("sipTrunkId"),
                    number: form.get("number"),
                    roomName: form.get("roomName"),
                    participantIdentity: form.get("participantIdentity"),
                  }),
                });
                event.currentTarget.reset();
                void load(rangeRef.current, true);
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="dial-trunk">Outbound trunk</Label>
              <select
                id="dial-trunk"
                name="sipTrunkId"
                required
                className="native-select h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono text-sm dark:bg-input/30"
              >
                <option value="">Select trunk</option>
                {sip.data.outbound.map((trunk) => (
                  <option key={trunk.id} value={trunk.id}>
                    {trunk.name}
                  </option>
                ))}
              </select>
            </div>
            <Field id="dial-number" name="number" label="Number to call" required placeholder="+15557654321" />
            <Field id="dial-room" name="roomName" label="Room" required placeholder="support" />
            <Field id="dial-identity" name="participantIdentity" label="SIP participant identity (optional)" />
            <div className="md:col-span-2">
              <Button type="submit" disabled={sip.pending === "dial" || sip.data.outbound.length === 0}>
                {sip.pending === "dial" ? "Dialing…" : "Create SIP participant"}
              </Button>
            </div>
          </form>
        </section>
      ) : (
        <PageSkeleton className="h-40" />
      )}

      {data.calls.length === 0 ? (
        <EmptyState
          title="No SIP calls in this range"
          description="Inbound dispatch or outbound dial will show here after join/leave webhooks arrive."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="bg-panel-2 text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">From</th>
                <th className="px-3 py-2 font-medium">To</th>
                <th className="px-3 py-2 font-medium">Direction</th>
                <th className="px-3 py-2 font-medium">Started</th>
                <th className="px-3 py-2 font-medium">Ended</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Session</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.calls.map((call) => (
                <tr key={call.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{call.identity}</td>
                  <td className="px-3 py-2 font-mono text-xs">{call.from ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{call.to ?? "—"}</td>
                  <td className="px-3 py-2 capitalize">{call.direction}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {formatWhen(call.startedAt)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {call.endedAt ? formatWhen(call.endedAt) : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums">
                    {formatDuration(call.durationSeconds)}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/dashboard/${projectId}/sessions`}
                      className="font-mono text-xs text-live hover:underline"
                    >
                      {call.roomName}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={call.status === "live" ? "secondary" : "outline"}
                      className={call.status === "live" ? "text-live" : undefined}
                    >
                      {call.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
