"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

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

type ViewMode = "event" | "month";
type Display = "count" | "percent";

interface Props {
  byEvent: ByEvent[];
  byMonth: ByMonth[];
}

export function AttendeeBreakdownChart({ byEvent, byMonth }: Props) {
  const [viewMode, setViewMode] = React.useState<ViewMode>("event");
  const [display, setDisplay] = React.useState<Display>("count");

  const rawData = viewMode === "event" ? byEvent : byMonth;
  const xKey = viewMode === "event" ? "date" : "month";

  const data = React.useMemo(() => {
    return rawData.map((row) => {
      const total = row.newCount + row.returningCount + row.communityCount;
      if (total === 0) {
        return { ...row, total, newPct: 0, returningPct: 0, communityPct: 0 };
      }
      // Largest Remainder Method — guarantees integer percentages sum to 100.
      const exactNew = (row.newCount / total) * 100;
      const exactRet = (row.returningCount / total) * 100;
      const exactCom = (row.communityCount / total) * 100;
      let flNew = Math.floor(exactNew);
      let flRet = Math.floor(exactRet);
      let flCom = Math.floor(exactCom);
      const remainder = 100 - flNew - flRet - flCom;
      const fracs = [
        { key: "new" as const, frac: exactNew - flNew },
        { key: "ret" as const, frac: exactRet - flRet },
        { key: "com" as const, frac: exactCom - flCom },
      ].sort((a, b) => b.frac - a.frac);
      for (let j = 0; j < remainder; j++) {
        const f = fracs[j];
        if (!f) break;
        if (f.key === "new") flNew++;
        else if (f.key === "ret") flRet++;
        else flCom++;
      }
      return {
        ...row,
        total,
        newPct: flNew,
        returningPct: flRet,
        communityPct: flCom,
      };
    });
  }, [rawData]);

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-muted-foreground text-sm">
        No data available
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(v) => {
            if (v) setViewMode(v as ViewMode);
          }}
          size="sm"
          variant="outline"
        >
          <ToggleGroupItem value="event">By Event</ToggleGroupItem>
          <ToggleGroupItem value="month">By Month</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          type="single"
          value={display}
          onValueChange={(v) => {
            if (v) setDisplay(v as Display);
          }}
          size="sm"
          variant="outline"
        >
          <ToggleGroupItem value="count">Count</ToggleGroupItem>
          <ToggleGroupItem value="percent">%</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <p className="text-muted-foreground text-xs">
        {display === "count"
          ? "Stacked bars: attendees by cohort. Line: running total of active community members."
          : "100% stacked: each bar shows the mix of new / returning / community among attendees."}
      </p>
      <ChartContainer config={chartConfig} className="h-[320px] w-full">
        {display === "count" ? (
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
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
              height={70}
              interval={data.length > 30 ? Math.floor(data.length / 15) : 0}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11 }}
              allowDecimals={false}
              label={{
                value: "Attendees",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 11, fill: "var(--muted-foreground)" },
              }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11 }}
              allowDecimals={false}
              label={{
                value: "Community total",
                angle: 90,
                position: "insideRight",
                style: { fontSize: 11, fill: "var(--muted-foreground)" },
              }}
            />
            <Tooltip
              content={
                <BreakdownTooltip viewMode={viewMode} display={display} />
              }
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
        ) : (
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
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
              height={70}
              interval={data.length > 30 ? Math.floor(data.length / 15) : 0}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
              label={{
                value: "Share of attendees",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 11, fill: "var(--muted-foreground)" },
              }}
            />
            <Tooltip
              content={
                <BreakdownTooltip viewMode={viewMode} display={display} />
              }
            />
            <Legend />
            <Area
              type="monotone"
              dataKey="newPct"
              stackId="1"
              stroke="var(--color-newCount)"
              fill="var(--color-newCount)"
              fillOpacity={0.75}
              name="New"
            />
            <Area
              type="monotone"
              dataKey="returningPct"
              stackId="1"
              stroke="var(--color-returningCount)"
              fill="var(--color-returningCount)"
              fillOpacity={0.75}
              name="Returning"
            />
            <Area
              type="monotone"
              dataKey="communityPct"
              stackId="1"
              stroke="var(--color-communityCount)"
              fill="var(--color-communityCount)"
              fillOpacity={0.75}
              name="Community"
            />
          </AreaChart>
        )}
      </ChartContainer>
    </div>
  );
}

function BreakdownTooltip({
  active,
  payload,
  viewMode,
  display,
}: {
  active?: boolean;
  payload?: Array<{ payload: Record<string, unknown> }>;
  viewMode: ViewMode;
  display: Display;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as {
    eventName?: string;
    date?: string;
    month?: string;
    newCount: number;
    returningCount: number;
    communityCount: number;
    total: number;
    newPct: number;
    returningPct: number;
    communityPct: number;
    communityGained: number;
    communityLost: number;
    cumulativeCommunity: number;
  };
  if (!d) return null;

  const fmtPct = (v: number) => `${v}%`;

  return (
    <div className="rounded border bg-background p-2 text-sm shadow-sm">
      {viewMode === "event" ? (
        <>
          <p className="font-medium">{d.eventName}</p>
          <p className="text-muted-foreground text-xs">{d.date}</p>
        </>
      ) : (
        <p className="font-medium">{d.month}</p>
      )}
      <p className="text-muted-foreground text-xs">Total: {d.total}</p>
      <hr className="my-1 border-border" />
      <p style={{ color: "var(--chart-2)" }}>
        New: {d.newCount} ({fmtPct(d.newPct)})
      </p>
      <p style={{ color: "var(--chart-3)" }}>
        Returning: {d.returningCount} ({fmtPct(d.returningPct)})
      </p>
      <p style={{ color: "var(--chart-4)" }}>
        Community: {d.communityCount} ({fmtPct(d.communityPct)})
      </p>
      {display === "count" && (
        <>
          <hr className="my-1 border-border" />
          <p className="text-xs">Community gained: +{d.communityGained}</p>
          <p className="text-xs">Community lost: −{d.communityLost}</p>
          <p style={{ color: "var(--chart-1)" }}>
            Total community: {d.cumulativeCommunity}
          </p>
        </>
      )}
    </div>
  );
}
