"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { InsightsLegend, RecordingPlayer } from "@/components/sessions/recording-player";
import { Badge } from "@/components/ui/badge";
import type { LiveWebhookEvent } from "@/lib/events/types";
import { formatSessionClock, formatWhen } from "@/lib/format";
import type { SessionRecording, SessionTranscriptLine, TranscriptSpeaker } from "@/lib/sessions/types";
import { cn } from "@/lib/utils";

export function AgentInsights({
  transcripts,
  recordings,
  events,
}: {
  transcripts: SessionTranscriptLine[];
  recordings: SessionRecording[];
  events: LiveWebhookEvent[];
}) {
  const [sub, setSub] = useState<"transcript" | "recordings" | "logs">("transcript");
  const [currentMs, setCurrentMs] = useState(0);
  const activeId = useMemo(() => {
    if (transcripts.length === 0) return null;
    let current: SessionTranscriptLine | null = null;
    for (const line of transcripts) {
      if (line.offsetMs <= currentMs) current = line;
    }
    return current?.id ?? null;
  }, [currentMs, transcripts]);

  return (
    <div className="space-y-4">
      <RecordingPlayer recordings={recordings} currentMs={currentMs} onTime={setCurrentMs} />
      <InsightsLegend />

      <div className="flex flex-wrap gap-1 border-b border-border">
        {(
          [
            ["transcript", "Transcript"],
            ["recordings", "Recordings"],
            ["logs", "Session logs"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSub(id)}
            className={cn(
              "rounded-t-md px-3 py-2 text-sm font-medium",
              sub === id
                ? "border-b-2 border-live text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {sub === "transcript" ? (
        transcripts.length === 0 ? (
          <EmptyState
            title="No transcript stored for this session"
            description="The agent posts conversation lines to Deck while the call is live. Self-hosted LiveKit does not send Cloud agent-observability transcripts."
          />
        ) : (
          <ol className="space-y-2">
            {transcripts.map((line) => (
              <li
                key={line.id}
                className={cn(
                  "rounded-lg border px-3 py-3",
                  line.id === activeId ? "border-live bg-live/5" : "border-border bg-card",
                )}
              >
                <div className="mb-1 flex items-center gap-2 text-xs">
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {formatSessionClock(line.offsetMs)}
                  </span>
                  <SpeakerBadge speaker={line.speaker} identity={line.identity} />
                </div>
                {line.speaker === "system" ? (
                  <p className="rounded-md bg-live/10 px-2 py-1.5 text-sm">{line.text}</p>
                ) : (
                  <p className="text-sm">{line.text}</p>
                )}
              </li>
            ))}
          </ol>
        )
      ) : null}

      {sub === "recordings" ? (
        recordings.length === 0 ? (
          <EmptyState
            title="No recordings for this session"
            description="Deck starts an audio recording when Talk, SIP, or any join opens a room. Files show here after the room ends. If this stays empty, check Egresses — livekit-egress must be running and GCS credentials must be set."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-panel-2 text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Started</th>
                  <th className="px-3 py-2 font-medium">Output</th>
                  <th className="px-3 py-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {recordings.map((recording) => (
                  <tr key={recording.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{recording.id}</td>
                    <td className="px-3 py-2">{recording.type}</td>
                    <td className="px-3 py-2">
                      <Badge variant={recording.status === "complete" || recording.status === "active" ? "secondary" : "outline"}>
                        {recording.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {recording.startedAt ? formatWhen(recording.startedAt) : "—"}
                    </td>
                    <td className="max-w-[280px] truncate px-3 py-2 font-mono text-xs">
                      {recording.playableUrl ? (
                        <a href={recording.playableUrl} className="text-live hover:underline" target="_blank" rel="noreferrer">
                          {recording.output}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">{recording.output ?? "—"}</span>
                      )}
                    </td>
                    <td className="max-w-[240px] truncate px-3 py-2 text-xs text-destructive">
                      {recording.error ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {sub === "logs" ? (
        events.length === 0 ? (
          <EmptyState title="No session logs" description="Webhook events for this room will list here." />
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
                    <td className="px-3 py-2 font-mono text-xs">{event.participantIdentity ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </div>
  );
}

function SpeakerBadge({
  speaker,
  identity,
}: {
  speaker: TranscriptSpeaker;
  identity: string | null;
}) {
  const label = speaker === "agent" ? "Agent" : speaker === "system" ? "System" : "User";
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge
        variant="outline"
        className={
          speaker === "agent"
            ? "border-violet-400/40 text-violet-300"
            : speaker === "system"
              ? "text-live"
              : undefined
        }
      >
        {label}
      </Badge>
      {identity ? <span className="font-mono text-muted-foreground">{identity}</span> : null}
    </span>
  );
}
