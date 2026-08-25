"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatWhen } from "@/lib/format";
import type { LiveWebhookEvent } from "@/lib/events/types";

export function OverviewEvents({
  projectId,
  events,
}: {
  projectId: string;
  events: LiveWebhookEvent[];
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Recent events</h2>
        <Link
          href={`/dashboard/${projectId}/events`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Open event log
        </Link>
      </div>
      {events.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Waiting for LiveKit webhooks. Last-received time is on the Events page.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {events.map((event) => (
            <li key={event.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <Badge variant="secondary" className="font-mono">
                  {event.eventType}
                </Badge>
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  {event.roomName ?? "—"}
                  {event.participantIdentity ? ` · ${event.participantIdentity}` : ""}
                </p>
              </div>
              <time
                className="shrink-0 font-mono text-[11px] text-muted-foreground"
                dateTime={event.createdAt}
                suppressHydrationWarning
              >
                {formatWhen(event.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
