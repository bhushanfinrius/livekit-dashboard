"use client";

import type { ReactNode } from "react";
import { AreaChart, DonutChart, SparkAreaChart } from "@tremor/react";
import { formatParticipantMinutes } from "@/lib/format";
import type { ChartPoint, KindSlice, RankedItem } from "@/lib/overview/types";
import { cn } from "@/lib/utils";

export function MetricHero({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-3 font-display text-4xl font-semibold tracking-tight text-live">{value}</p>
      {children}
    </section>
  );
}

export function UnavailableCard({
  label,
  reason,
}: {
  label: string;
  reason: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-6 text-sm text-muted-foreground">{reason}</p>
    </section>
  );
}

export function SuccessSpark({ data }: { data: ChartPoint[] }) {
  const chartData = data.map((point) => ({ date: point.date, Success: point.value }));
  return (
    <SparkAreaChart
      className="mt-6 h-16 w-full"
      data={chartData}
      index="date"
      categories={["Success"]}
      colors={["cyan"]}
      minValue={0}
      maxValue={100}
      curveType="monotone"
    />
  );
}

export function KindDonut({ data }: { data: KindSlice[] }) {
  const hasData = data.some((slice) => slice.minutes > 0);
  const totalMinutes = data.reduce((sum, slice) => sum + slice.minutes, 0);
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">Participant Minutes By Kind</p>
      {hasData ? (
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative mx-auto h-40 w-40">
            <DonutChart
              className="h-40 w-40 [&_.recharts-text]:fill-transparent [&_.recharts-label]:hidden"
              data={data}
              index="name"
              category="minutes"
              colors={["cyan", "violet", "orange"]}
              variant="donut"
              showLabel={false}
              showAnimation={false}
              valueFormatter={(value) => formatParticipantMinutes(value)}
            />
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-sm tabular-nums">
              {formatParticipantMinutes(totalMinutes)}
            </p>
          </div>
          <ul className="space-y-2 text-sm">
            {data.map((slice, index) => (
              <li key={slice.name} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      index === 0 && "bg-cyan-400",
                      index === 1 && "bg-violet-400",
                      index === 2 && "bg-orange-400",
                    )}
                  />
                  {slice.name}
                </span>
                <span className="font-mono tabular-nums">
                  {formatParticipantMinutes(slice.minutes)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          Kind breakdown appears after join/leave webhooks arrive.
        </p>
      )}
    </section>
  );
}

export function RankedList({
  label,
  items,
  empty,
}: {
  label: string;
  items: RankedItem[];
  empty: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      {items.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {items.map((item, index) => (
            <li key={item.name} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-3">
                <span className="w-4 font-mono text-muted-foreground">{index + 1}.</span>
                <span className="truncate">{item.name}</span>
              </span>
              <span className="font-mono tabular-nums text-muted-foreground">{item.count}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function ParticipantsTimeline({ data }: { data: ChartPoint[] }) {
  const chartData = data.map((point) => ({ date: point.date, Participants: point.value }));
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">Participants</p>
      <AreaChart
        className="mt-4 h-72"
        data={chartData}
        index="date"
        categories={["Participants"]}
        colors={["cyan"]}
        valueFormatter={(value) => String(Math.round(value))}
        showLegend={false}
        showAnimation={false}
        autoMinValue
        curveType="monotone"
        noDataText="No participant history in this window yet"
      />
    </section>
  );
}
