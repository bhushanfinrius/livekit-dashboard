"use client";

import { AreaChart } from "@tremor/react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { AgentInsights } from "@/components/sessions/agent-insights";
import { FeaturePills } from "@/components/sessions/feature-pills";
import { Badge } from "@/components/ui/badge";
import { formatDuration, formatParticipantMinutes, formatWhen } from "@/lib/format";
import { kindShort } from "@/lib/overview/payload";
import type { SessionDetailPayload } from "@/lib/sessions/types";
import { cn } from "@/lib/utils";

export function SessionDetailView({
  projectId,
  initial,
}: {
  projectId: string;
  initial: SessionDetailPayload;
}) {
  const { session, events, timeline, webrtcMinutes, transcripts = [], recordings = [] } = initial;
  const [tab, setTab] = useState<"analytics" | "events" | "agent">("analytics");
  const duration =
    session.status === "live"
      ? Math.max(0, Math.round((Date.now() - Date.parse(session.startedAt)) / 1000))
      : session.durationSeconds;
  const chartData = timeline.map((point) => ({ date: point.date, Participants: point.value }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/dashboard/${projectId}/sessions`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Sessions
          </Link>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight">
            {session.roomName}
          </h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{session.id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FeaturePills features={session.features} />
          {session.status === "live" ? (
            <Badge variant="secondary" className="text-live">
              live
            </Badge>
          ) : session.implicit ? (
            <Badge variant="outline">inferred</Badge>
          ) : (
            <Badge variant="outline">closed</Badge>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {([
          { id: "analytics" as const, label: "Session analytics" },
          { id: "events" as const, label: "Session events" },
          { id: "agent" as const, label: "Agent insights" },
        ]).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "rounded-t-md px-3 py-2 text-sm font-medium",
              tab === item.id
                ? "border-b-2 border-live text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "analytics" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Metric label="Room" value={session.roomName} mono />
            <Metric label="Started" value={formatWhen(session.startedAt)} mono />
            <Metric
              label="Ended"
              value={session.endedAt ? formatWhen(session.endedAt) : "in progress"}
              mono
            />
            <Metric label="Duration" value={formatDuration(duration)} />
            <Metric label="Unique participants" value={String(session.participantCount)} />
            <Metric label="WebRTC minutes" value={formatParticipantMinutes(webrtcMinutes)} />
          </div>

          <section className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Session timeline</p>
            <AreaChart
              className="mt-4 h-64"
              data={chartData}
              index="date"
              categories={["Participants"]}
              colors={["emerald"]}
              valueFormatter={(value) => String(Math.round(value))}
              showLegend={false}
              showAnimation={false}
              autoMinValue
              curveType="monotone"
              noDataText="No participant history for this session"
            />
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-medium">Publishers</h3>
            {session.participants.length === 0 ? (
              <EmptyState
                title="No publishers"
                description="No join/leave events were stored for this room."
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-panel-2 text-xs tracking-wide text-muted-foreground uppercase">
                    <tr>
                      <th className="px-3 py-2 font-medium">Identity</th>
                      <th className="px-3 py-2 font-medium">Kind</th>
                      <th className="px-3 py-2 font-medium">Joined</th>
                      <th className="px-3 py-2 font-medium">Left</th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.participants.map((participant) => (
                      <tr
                        key={`${participant.identity}:${participant.joinedAt}`}
                        className="border-t border-border"
                      >
                        <td className="px-3 py-2 font-mono">{participant.identity}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline">{kindShort(participant.kind)}</Badge>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {formatWhen(participant.joinedAt)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {participant.leftAt ? formatWhen(participant.leftAt) : "in room"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {tab === "events" ? (
        events.length === 0 ? (
          <EmptyState
            title="No events for this session"
            description="Webhook events for this room will list here."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-panel-2 text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Identity</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {formatWhen(event.createdAt)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{event.eventType}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {event.participantIdentity ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === "agent" ? (
        <AgentInsights transcripts={transcripts} recordings={recordings} events={events} />
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={cn("mt-2 text-sm", mono && "font-mono")}>{value}</p>
    </div>
  );
}
