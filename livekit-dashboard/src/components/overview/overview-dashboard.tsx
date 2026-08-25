"use client";

import { ChevronDown, Clock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { OverviewEvents } from "@/components/overview/overview-events";
import {
  KindDonut,
  MetricHero,
  ParticipantsTimeline,
  RankedList,
  SuccessSpark,
  UnavailableCard,
} from "@/components/overview/overview-cards";
import {
  AgentsSection,
  RoomsSection,
  TelephonySection,
} from "@/components/overview/overview-sections";
import { StatusLine } from "@/components/page-skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiJson } from "@/lib/api/client";
import type { LiveWebhookEvent } from "@/lib/events/types";
import { formatParticipantMinutes } from "@/lib/format";
import { minutesForKind } from "@/lib/overview/series";
import {
  OVERVIEW_RANGE_LABELS,
  OVERVIEW_RANGES,
  type OverviewPayload,
  type OverviewRange,
} from "@/lib/overview/types";

function mergeEvents(current: LiveWebhookEvent[], incoming: LiveWebhookEvent[]) {
  const seen = new Set(current.map((event) => event.id));
  const next = [...current];
  for (const event of incoming) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    next.push(event);
  }
  return next
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 20);
}

export function OverviewDashboard({
  projectId,
  initial,
}: {
  projectId: string;
  initial: OverviewPayload;
}) {
  const [data, setData] = useState(initial);
  const [range, setRange] = useState<OverviewRange>(initial.range);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [participantsOpen, setParticipantsOpen] = useState(true);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const load = useCallback(
    async (nextRange: OverviewRange, silent = false) => {
      if (!silent) setLoading(true);
      try {
        const payload = await apiJson<OverviewPayload>(
          `/api/projects/${projectId}/overview?range=${nextRange}`,
        );
        setData(payload);
        setError(null);
      } catch (caught) {
        if (!silent) {
          setError(caught instanceof Error ? caught.message : "Could not refresh overview");
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
    }, 15_000);
    return () => window.clearInterval(poll);
  }, [load]);

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource(`/api/projects/${projectId}/events/stream`);

    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as LiveWebhookEvent;
      setData((current) => ({
        ...current,
        recentEvents: mergeEvents(current.recentEvents, [event]),
      }));
      window.clearTimeout(debounce);
      debounce = setTimeout(() => {
        void load(rangeRef.current, true);
      }, 1200);
    };

    return () => {
      window.clearTimeout(debounce);
      source.close();
    };
  }, [load, projectId]);

  const live = data.live;
  const webrtcMinutes = minutesForKind(data.minutesByKind, "WebRTC");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {live.reachable
            ? `Now: ${live.activeRooms} rooms · ${live.participants} connected · ${live.activeEgress} egress`
            : live.error ?? "LiveKit unreachable"}
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

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricHero
          label="Connection Success"
          value={data.connectionSuccessPct === null ? "–" : `${data.connectionSuccessPct}%`}
        >
          <SuccessSpark data={data.connectionSuccess} />
        </MetricHero>
        <UnavailableCard
          label="Platforms"
          reason="OS and browser shares come from LiveKit Cloud client telemetry. Self-hosted webhooks do not include them."
        />
        <UnavailableCard
          label="Connection Type"
          reason="UDP vs TURN is ICE-path telemetry from Cloud. This server does not report it on webhooks."
        />
        <RankedList
          label="Top regions"
          items={data.topRegions}
          empty="No region on stored joins. Self-hosted webhooks don’t include client GeoIP (Cloud’s top countries)."
        />
      </section>

      <section>
        <button
          type="button"
          className="mb-3 flex items-center gap-2 rounded-md text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => setParticipantsOpen((open) => !open)}
        >
          <ChevronDown className={participantsOpen ? "rotate-0" : "-rotate-90"} />
          Participants
        </button>
        {participantsOpen ? (
          <div className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-2">
              <MetricHero
                label="WebRTC Participant Minutes"
                value={formatParticipantMinutes(webrtcMinutes)}
              />
              <KindDonut data={data.minutesByKind} />
            </div>
            <ParticipantsTimeline data={data.participantCounts} />
          </div>
        ) : null}
      </section>

      <RoomsSection
        totalSessions={data.rooms.totalSessions}
        averageSize={data.rooms.averageSize}
        averageDurationSeconds={data.rooms.averageDurationSeconds}
        sessionCounts={data.rooms.sessionCounts}
      />
      <AgentsSection minutes={data.agents.minutes} concurrent={data.agents.concurrent} />
      <TelephonySection
        minutes={data.telephony.minutes}
        sipSessions={data.telephony.sipSessions}
        sipJoins={data.telephony.sipJoins}
        inboundMinutes={data.telephony.inboundMinutes}
        outboundMinutes={data.telephony.outboundMinutes}
        minutesSeries={data.telephony.minutesSeries}
        hasDirection={data.telephony.hasDirection}
      />

      <OverviewEvents projectId={projectId} events={data.recentEvents} />
    </div>
  );
}
