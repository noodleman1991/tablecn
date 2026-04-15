"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";
import type { CohortRow } from "../../types";

const chartConfig = {
  newPct: { label: "New %", color: "var(--chart-2)" },
  returningPct: { label: "Returning %", color: "var(--chart-3)" },
  communityPct: { label: "Community %", color: "var(--chart-4)" },
} satisfies ChartConfig;

interface Props {
  data: CohortRow[];
  bucket: "event" | "month";
}

export function RetentionRateTrendChart({ data, bucket }: Props) {
  const chartData = React.useMemo(() => {
    return data
      .filter((r) => r.totalCount > 0)
      .map((r) => ({
        label: r.bucketLabel,
        bucket: r.bucket,
        newPct: r.totalCount > 0 ? (r.newCount / r.totalCount) * 100 : 0,
        returningPct:
          r.totalCount > 0 ? (r.returningCount / r.totalCount) * 100 : 0,
        communityPct:
          r.totalCount > 0 ? (r.communityCount / r.totalCount) * 100 : 0,
        newCount: r.newCount,
        returningCount: r.returningCount,
        communityCount: r.communityCount,
        totalCount: r.totalCount,
      }));
  }, [data]);

  if (chartData.length === 0) {
    return (
      <p className="py-8 text-center text-muted-foreground text-sm">
        No data available
      </p>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="h-[320px] w-full">
      <AreaChart data={chartData} margin={{ bottom: 20, left: 0, right: 10 }}>
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10 }}
          tickFormatter={(v) => {
            if (bucket === "month") return v;
            return String(v).length > 18 ? String(v).slice(0, 18) + "…" : v;
          }}
          angle={-45}
          textAnchor="end"
          height={70}
          interval={
            chartData.length > 30 ? Math.floor(chartData.length / 15) : 0
          }
        />
        <YAxis
          tick={{ fontSize: 11 }}
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0]?.payload;
            if (!d) return null;
            return (
              <div className="rounded border bg-background p-2 text-sm shadow-sm">
                <p className="font-medium">{d.label}</p>
                <p className="text-muted-foreground">
                  Total attendees: {d.totalCount}
                </p>
                <hr className="my-1 border-border" />
                <p style={{ color: "var(--chart-2)" }}>
                  New: {d.newCount} ({d.newPct.toFixed(1)}%)
                </p>
                <p style={{ color: "var(--chart-3)" }}>
                  Returning: {d.returningCount} ({d.returningPct.toFixed(1)}%)
                </p>
                <p style={{ color: "var(--chart-4)" }}>
                  Community: {d.communityCount} ({d.communityPct.toFixed(1)}%)
                </p>
              </div>
            );
          }}
        />
        <Legend />
        <Area
          type="monotone"
          dataKey="newPct"
          stackId="1"
          stroke="var(--color-newPct)"
          fill="var(--color-newPct)"
          name="New %"
        />
        <Area
          type="monotone"
          dataKey="returningPct"
          stackId="1"
          stroke="var(--color-returningPct)"
          fill="var(--color-returningPct)"
          name="Returning %"
        />
        <Area
          type="monotone"
          dataKey="communityPct"
          stackId="1"
          stroke="var(--color-communityPct)"
          fill="var(--color-communityPct)"
          name="Community %"
        />
      </AreaChart>
    </ChartContainer>
  );
}
