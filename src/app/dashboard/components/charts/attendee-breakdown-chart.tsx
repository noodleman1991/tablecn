"use client";

import * as React from "react";
import {
  Bar,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";

const chartConfig = {
  newCount: { label: "New", color: "var(--chart-2)" },
  returningCount: { label: "Returning", color: "var(--chart-3)" },
  communityCount: { label: "Community", color: "var(--chart-4)" },
  cumulativeCommunity: { label: "Total Community", color: "var(--chart-1)" },
} satisfies ChartConfig;

interface ByEvent {
  eventName: string;
  date: string;
  newCount: number;
  returningCount: number;
  communityCount: number;
  communityGained: number;
  communityLost: number;
  cumulativeCommunity: number;
}

interface ByMonth {
  month: string;
  newCount: number;
  returningCount: number;
  communityCount: number;
  communityGained: number;
  communityLost: number;
  cumulativeCommunity: number;
}

interface Props {
  byEvent: ByEvent[];
  byMonth: ByMonth[];
}

export function AttendeeBreakdownChart({ byEvent, byMonth }: Props) {
  const [viewMode, setViewMode] = React.useState<"event" | "month">("event");

  const data = viewMode === "event" ? byEvent : byMonth;

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No data available</p>;
  }

  const xKey = viewMode === "event" ? "date" : "month";

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">
        Total Community = people with 3+ countable events and at least 1 in the last 9 months
      </p>
      <div className="flex gap-1 mb-4">
        <Button
          variant={viewMode === "event" ? "default" : "outline"}
          size="sm"
          onClick={() => setViewMode("event")}
        >
          By Event
        </Button>
        <Button
          variant={viewMode === "month" ? "default" : "outline"}
          size="sm"
          onClick={() => setViewMode("month")}
        >
          By Month
        </Button>
      </div>
      <ChartContainer config={chartConfig} className="h-[300px] w-full">
        <ComposedChart data={data}>
          <XAxis
            dataKey={xKey}
            tick={{ fontSize: 10 }}
            tickFormatter={(v) => {
              if (viewMode === "event") {
                const d = new Date(v);
                return `${d.getDate()}/${d.getMonth() + 1}`;
              }
              return v;
            }}
            angle={-45}
            textAnchor="end"
            height={60}
            interval={data.length > 30 ? Math.floor(data.length / 15) : 0}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11 }}
            allowDecimals={false}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11 }}
            allowDecimals={false}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              return (
                <div className="rounded border bg-background p-2 text-sm shadow-sm">
                  {viewMode === "event" ? (
                    <>
                      <p className="font-medium">{d.eventName}</p>
                      <p className="text-muted-foreground">{d.date}</p>
                    </>
                  ) : (
                    <p className="font-medium">{d.month}</p>
                  )}
                  <p style={{ color: "var(--chart-2)" }}>New: {d.newCount}</p>
                  <p style={{ color: "var(--chart-3)" }}>Returning: {d.returningCount}</p>
                  <p style={{ color: "var(--chart-4)" }}>Community: {d.communityCount}</p>
                  <hr className="my-1 border-border" />
                  <p>Community gained: +{d.communityGained}</p>
                  <p>Community lost: −{d.communityLost}</p>
                  <p style={{ color: "var(--chart-1)" }}>Total community: {d.cumulativeCommunity}</p>
                </div>
              );
            }}
          />
          <Legend />
          <Bar
            yAxisId="left"
            dataKey="newCount"
            fill="var(--color-newCount)"
            stackId="stack"
            name="New"
          />
          <Bar
            yAxisId="left"
            dataKey="returningCount"
            fill="var(--color-returningCount)"
            stackId="stack"
            name="Returning"
          />
          <Bar
            yAxisId="left"
            dataKey="communityCount"
            fill="var(--color-communityCount)"
            stackId="stack"
            radius={[4, 4, 0, 0]}
            name="Community"
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="cumulativeCommunity"
            stroke="var(--color-cumulativeCommunity)"
            strokeWidth={2}
            dot={{ r: 3 }}
            name="Total Community"
          />
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}
