"use client";

import { SparkAreaChart } from "@tremor/react";
import { ChevronDown, Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusLine } from "@/components/page-skeleton";
import { FeaturePills } from "@/components/sessions/feature-pills";
import { apiJson } from "@/lib/api/client";
import type { LiveWebhookEvent } from "@/lib/events/types";
import { formatDuration, formatRelativeTime } from "@/lib/format";
import {
  OVERVIEW_RANGE_LABELS,
  OVERVIEW_RANGES,
  type ChartPoint,
  type OverviewRange,
} from "@/lib/overview/types";
import { SESSION_EVENT_TYPES, sessionDisplayId } from "@/lib/sessions/types";
import type { SessionSnapshot, SessionsPayload } from "@/lib/sessions/types";

const SESSION_EVENTS = new Set<string>(SESSION_EVENT_TYPES);

export function SessionsView({
  projectId,
  initial,
}: {
  projectId: string;
  initial: SessionsPayload;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [range, setRange] = useState<OverviewRange>(initial.range);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const load = useCallback(
    async (nextRange: OverviewRange, silent = false) => {
      if (!silent) setLoading(true);
      try {
        const payload = await apiJson<SessionsPayload>(
          `/api/projects/${projectId}/sessions?range=${nextRange}`,
        );
        setData(payload);
        setError(null);
      } catch (caught) {
        if (!silent) {
          setError(caught instanceof Error ? caught.message : "Could not load sessions");
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    const poll = window.setInterval(() => {
      void load(rangeRef.current, true);
    }, 15_000);
    return () => window.clearInterval(poll);
  }, [load]);

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource(`/api/projects/${projectId}/events/stream`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as LiveWebhookEvent;
      if (!SESSION_EVENTS.has(event.eventType)) return;
      window.clearTimeout(debounce);
      debounce = setTimeout(() => {
        void load(rangeRef.current, true);
      }, 300);
    };
    return () => {
      window.clearTimeout(debounce);
      source.close();
    };
  }, [load, projectId]);

  const sessions = data.sessions;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Rooms reconstructed from LiveKit webhooks, plus any recording jobs from{" "}
          <span className="font-mono">livekit-egress</span>. Open a session for the
          Recordings tab.
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

      <StatusLine error={error} loading={loading} />

      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryCard
          label="Unique participants"
          value={String(data.uniqueParticipants)}
          series={data.uniqueParticipantSeries}
        />
        <SummaryCard
          label="Total rooms"
          value={String(sessions.length)}
          series={data.roomCountSeries}
        />
      </div>

      {sessions.length === 0 ? (
        <EmptyState
          title="No session history in this range"
          description="Make a Talk or SIP call so LumiVoice can store room events and start an audio recording. Recordings also appear on Egresses."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="bg-panel-2 text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Session ID</th>
                <th className="px-3 py-2 font-medium">Room name</th>
                <th className="px-3 py-2 font-medium">Started</th>
                <th className="px-3 py-2 font-medium">Ended</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Participants</th>
                <th className="px-3 py-2 font-medium">Features</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const duration =
                  session.status === "live"
                    ? Math.max(0, Math.round((now - Date.parse(session.startedAt)) / 1000))
                    : session.durationSeconds;
                return (
                  <tr
                    key={session.id}
                    className="cursor-pointer border-t border-border hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
                    tabIndex={0}
                    onClick={() =>
                      router.push(
                        `/dashboard/${projectId}/sessions/${encodeURIComponent(session.id)}`,
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        router.push(
                          `/dashboard/${projectId}/sessions/${encodeURIComponent(session.id)}`,
                        );
                      }
                    }}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{sessionDisplayId(session)}</td>
                    <td className="px-3 py-2 font-mono">{session.roomName}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {formatRelativeTime(session.startedAt, now)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {session.endedAt ? formatRelativeTime(session.endedAt, now) : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums text-muted-foreground">
                      {formatDuration(duration)}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums">{session.participantCount}</td>
                    <td className="px-3 py-2">
                      <FeaturePills features={session.features} />
                    </td>
                    <td className="px-3 py-2">
                      <SessionStatus session={session} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  series,
}: {
  label: string;
  value: string;
  series: ChartPoint[];
}) {
  const chartData = series.map((point) => ({ date: point.date, Value: point.value }));
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-3xl font-semibold tracking-tight">{value}</p>
      <SparkAreaChart
        className="mt-4 h-16 w-full"
        data={chartData}
        index="date"
        categories={["Value"]}
        colors={["emerald"]}
        curveType="monotone"
      />
    </section>
  );
}

function SessionStatus({ session }: { session: SessionSnapshot }) {
  if (session.status === "live") {
    return (
      <Badge variant="secondary" className="text-live">
        live
      </Badge>
    );
  }
  if (session.implicit) {
    return <Badge variant="outline">inferred</Badge>;
  }
  return <Badge variant="outline">closed</Badge>;
}
