"use client";

import { AreaChart, SparkAreaChart } from "@tremor/react";
import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { MetricHero } from "@/components/overview/overview-cards";
import { formatDuration, formatParticipantMinutes } from "@/lib/format";
import type { ChartPoint } from "@/lib/overview/types";

export function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button
        type="button"
        className="mb-3 flex items-center gap-2 rounded-md text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown className={open ? "rotate-0" : "-rotate-90"} />
        {title}
      </button>
      {open ? <div className="space-y-3">{children}</div> : null}
    </section>
  );
}

export function SparkMetric({
  label,
  value,
  data,
  category = "Value",
}: {
  label: string;
  value: string;
  data: ChartPoint[];
  category?: string;
}) {
  const chartData = data.map((point) => ({ date: point.date, [category]: point.value }));
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-3 font-display text-3xl font-semibold tracking-tight">{value}</p>
      <SparkAreaChart
        className="mt-4 h-16 w-full"
        data={chartData}
        index="date"
        categories={[category]}
        colors={["emerald"]}
        curveType="monotone"
      />
    </section>
  );
}

export function RoomsSection({
  totalSessions,
  averageSize,
  averageDurationSeconds,
  sessionCounts,
}: {
  totalSessions: number;
  averageSize: number;
  averageDurationSeconds: number;
  sessionCounts: ChartPoint[];
}) {
  return (
    <CollapsibleSection title="Rooms">
      <div className="grid gap-3 lg:grid-cols-3">
        <SparkMetric label="Room sessions" value={String(totalSessions)} data={sessionCounts} />
        <MetricHero label="Average room size" value={String(averageSize)} />
        <MetricHero label="Average duration" value={formatDuration(averageDurationSeconds)} />
      </div>
    </CollapsibleSection>
  );
}

export function AgentsSection({
  minutes,
  concurrent,
}: {
  minutes: number;
  concurrent: ChartPoint[];
}) {
  const chartData = concurrent.map((point) => ({ date: point.date, Agents: point.value }));
  return (
    <CollapsibleSection title="Agents">
      <div className="grid gap-3 lg:grid-cols-2">
        <MetricHero label="Agent session minutes" value={formatParticipantMinutes(minutes)} />
        <section className="rounded-lg border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">Concurrent agent sessions</p>
          <AreaChart
            className="mt-4 h-48"
            data={chartData}
            index="date"
            categories={["Agents"]}
            colors={["emerald"]}
            valueFormatter={(value) => String(Math.round(value))}
            showLegend={false}
            showAnimation={false}
            autoMinValue
            curveType="monotone"
            noDataText="No agent participants in this window"
          />
        </section>
      </div>
    </CollapsibleSection>
  );
}

export function TelephonySection({
  minutes,
  sipSessions,
  sipJoins,
  inboundMinutes,
  outboundMinutes,
  minutesSeries,
  hasDirection,
}: {
  minutes: number;
  sipSessions: number;
  sipJoins: ChartPoint[];
  inboundMinutes: ChartPoint[];
  outboundMinutes: ChartPoint[];
  minutesSeries: ChartPoint[];
  hasDirection: boolean;
}) {
  const sipChart = hasDirection
    ? inboundMinutes.map((point, index) => ({
        date: point.date,
        Inbound: point.value,
        Outbound: outboundMinutes[index]?.value ?? 0,
      }))
    : minutesSeries.map((point) => ({ date: point.date, SIP: point.value }));

  return (
    <CollapsibleSection title="Telephony">
      <div className="grid gap-3 lg:grid-cols-3">
        <MetricHero label="SIP participant minutes" value={formatParticipantMinutes(minutes)} />
        <MetricHero label="SIP sessions" value={String(sipSessions)} />
        <SparkMetric label="SIP joins" value={String(sipJoins.reduce((sum, point) => sum + point.value, 0))} data={sipJoins} />
      </div>
      <section className="rounded-lg border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">
          {hasDirection ? "Inbound vs outbound SIP minutes" : "SIP minutes"}
        </p>
        <AreaChart
          className="mt-4 h-48"
          data={sipChart}
          index="date"
          categories={hasDirection ? ["Inbound", "Outbound"] : ["SIP"]}
          colors={hasDirection ? ["emerald", "violet"] : ["emerald"]}
          valueFormatter={(value) => String(Math.round(value * 10) / 10)}
          showLegend={hasDirection}
          showAnimation={false}
          autoMinValue
          curveType="monotone"
          noDataText="No SIP participants in this window"
        />
      </section>
    </CollapsibleSection>
  );
}
