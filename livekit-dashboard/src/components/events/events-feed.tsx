"use client";

import { Check, ChevronDown, Clock, Copy } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StatusLine } from "@/components/page-skeleton";
import { WebhookUrls } from "@/components/webhooks/webhook-urls";
import { apiJson } from "@/lib/api/client";
import {
  EVENT_LOG_RANGE_LABELS,
  EVENT_LOG_RANGES,
  eventMatchesQuery,
  KNOWN_EVENT_TYPES,
  type EventLogPayload,
  type EventLogQuery,
  type EventLogRange,
  type LiveWebhookEvent,
  type WebhookEventDetail,
} from "@/lib/events/types";
import { formatWhen } from "@/lib/format";

const DEFAULT_QUERY: EventLogQuery = {
  range: "all",
  page: 1,
  pageSize: 50,
};

function queryString(query: EventLogQuery) {
  const params = new URLSearchParams();
  if (query.type) params.set("type", query.type);
  if (query.q) params.set("q", query.q);
  params.set("range", query.range);
  params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize));
  return params.toString();
}

export function EventsFeed({
  projectId,
  initial,
}: {
  projectId: string;
  initial: EventLogPayload;
}) {
  const [query, setQuery] = useState<EventLogQuery>(DEFAULT_QUERY);
  const [search, setSearch] = useState("");
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WebhookEventDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;
  const skipSearch = useRef(true);

  const load = useCallback(
    async (next: EventLogQuery, silent = false) => {
      if (!silent) setLoading(true);
      try {
        const payload = await apiJson<EventLogPayload>(
          `/api/projects/${projectId}/events?${queryString(next)}`,
        );
        setData(payload);
        setError(null);
      } catch (caught) {
        if (!silent) {
          setError(caught instanceof Error ? caught.message : "Could not load events");
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    if (skipSearch.current) {
      skipSearch.current = false;
      return;
    }
    const handle = window.setTimeout(() => {
      const next = { ...queryRef.current, q: search.trim() || undefined, page: 1 };
      setQuery(next);
      void load(next);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [load, search]);

  useEffect(() => {
    const source = new EventSource(`/api/projects/${projectId}/events/stream`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as LiveWebhookEvent;
      setData((current) => {
        const lastAt =
          !current.lastAt || Date.parse(event.createdAt) > Date.parse(current.lastAt)
            ? event.createdAt
            : current.lastAt;
        const types = current.eventTypes.includes(event.eventType)
          ? current.eventTypes
          : [...current.eventTypes, event.eventType].sort();
        const currentQuery = queryRef.current;
        if (currentQuery.page !== 1 || !eventMatchesQuery(event, currentQuery)) {
          return { ...current, lastAt, eventTypes: types };
        }
        if (current.events.some((item) => item.id === event.id)) {
          return { ...current, lastAt, eventTypes: types };
        }
        return {
          ...current,
          lastAt,
          eventTypes: types,
          total: current.total + 1,
          events: [event, ...current.events].slice(0, current.pageSize),
        };
      });
    };
    return () => source.close();
  }, [projectId]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    void apiJson<{ event: WebhookEventDetail }>(
      `/api/projects/${projectId}/events/${encodeURIComponent(selectedId)}`,
    )
      .then((payload) => {
        if (!cancelled) setDetail(payload.event);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setDetailError(caught instanceof Error ? caught.message : "Could not load payload");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedId]);

  const typeOptions = useMemo(() => {
    const extra = data.eventTypes.filter(
      (type) => !(KNOWN_EVENT_TYPES as readonly string[]).includes(type),
    );
    return [...KNOWN_EVENT_TYPES, ...extra];
  }, [data.eventTypes]);

  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));

  function apply(partial: Partial<EventLogQuery>) {
    const next = { ...query, ...partial };
    setQuery(next);
    void load(next);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card px-4 py-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Last webhook received
        </p>
        <p className="mt-2 font-mono text-lg font-medium tracking-tight">
          {data.lastAt ? formatWhen(data.lastAt) : "never"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          If this stays on never, LiveKit is not reaching Deck. Check the URL,
          port, and API key in <span className="font-mono">livekit.yaml</span>.
        </p>
      </section>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search room, participant, type…"
          className="max-w-sm font-mono"
        />
        <div className="flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                {query.type ?? "All types"}
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
              <DropdownMenuItem onClick={() => apply({ type: undefined, page: 1 })}>
                All types
              </DropdownMenuItem>
              {typeOptions.map((type) => (
                <DropdownMenuItem key={type} onClick={() => apply({ type, page: 1 })}>
                  {type}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Clock />
                {EVENT_LOG_RANGE_LABELS[query.range]}
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {EVENT_LOG_RANGES.map((option) => (
                <DropdownMenuItem
                  key={option}
                  onClick={() => apply({ range: option as EventLogRange, page: 1 })}
                >
                  {EVENT_LOG_RANGE_LABELS[option]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <StatusLine error={error} loading={loading} />

      {data.events.length === 0 ? (
        <EmptyState
          title={data.total === 0 && !query.q && !query.type && query.range === "all"
            ? "No webhook events received"
            : "No events match these filters"}
          description={
            data.lastAt
              ? "Try another type, date range, or search."
              : "Create a room or join with a participant. Events appear here live as LiveKit posts them."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-panel-2 text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Room</th>
                <th className="px-3 py-2 font-medium">Participant</th>
                <th className="px-3 py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((event) => (
                <tr
                  key={event.id}
                  tabIndex={0}
                  className="cursor-pointer border-t border-border hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
                  onClick={() => setSelectedId(event.id)}
                  onKeyDown={(eventKey) => {
                    if (eventKey.key === "Enter" || eventKey.key === " ") {
                      eventKey.preventDefault();
                      setSelectedId(event.id);
                    }
                  }}
                >
                  <td className="px-3 py-2">
                    <Badge variant="secondary" className="font-mono">
                      {event.eventType}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{event.roomName ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {event.participantIdentity ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {formatWhen(event.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <p>
          {data.total} event{data.total === 1 ? "" : "s"}
          {pageCount > 1 ? ` · page ${data.page} of ${pageCount}` : ""}
        </p>
        {pageCount > 1 ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={data.page <= 1}
              onClick={() => apply({ page: data.page - 1 })}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={data.page >= pageCount}
              onClick={() => apply({ page: data.page + 1 })}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Webhook URL</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Point your LiveKit server at one of these endpoints.
        </p>
        <WebhookUrls projectId={projectId} />
      </section>

      <Sheet
        open={Boolean(selectedId)}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <SheetContent className="sm:max-w-lg">
          <SheetHeader className="border-b border-border">
            <SheetTitle className="font-mono text-base">
              {detail?.eventType ?? "Event"}
            </SheetTitle>
            <SheetDescription>
              {detail ? formatWhen(detail.createdAt) : "Raw webhook payload"}
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
            {detailError ? <p className="text-sm text-destructive">{detailError}</p> : null}
            {!detail && !detailError ? (
              <p className="text-sm text-muted-foreground">Loading payload…</p>
            ) : null}
            {detail ? <PayloadView value={detail.rawPayload} /> : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PayloadView({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => JSON.stringify(value, null, 2), [value]);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy JSON"}
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1 rounded-md border border-border bg-panel-2">
        <pre className="p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
          {text}
        </pre>
      </ScrollArea>
    </>
  );
}
