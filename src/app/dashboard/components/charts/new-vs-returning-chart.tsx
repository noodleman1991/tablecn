"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CohortRow } from "../../types";

const chartConfig = {
  newCount: { label: "New", color: "var(--chart-2)" },
  returningCount: { label: "Returning", color: "var(--chart-3)" },
  communityCount: { label: "Community", color: "var(--chart-4)" },
} satisfies ChartConfig;

interface Props {
  data: CohortRow[];
  bucket: "event" | "month";
}

type Display = "count" | "percent";

export function NewVsReturningChart({ data, bucket }: Props) {
  const [display, setDisplay] = React.useState<Display>("count");

  const chartData = React.useMemo(() => {
    return data.map((r) => {
      const total = r.totalCount || 1; // avoid div/0 in percent mode display
      return {
        label: r.bucketLabel,
        bucket: r.bucket,
        newCount: r.newCount,
        returningCount: r.returningCount,
        communityCount: r.communityCount,
        totalCount: r.totalCount,
        newPct: (r.newCount / total) * 100,
        returningPct: (r.returningCount / total) * 100,
        communityPct: (r.communityCount / total) * 100,
      };
    });
  }, [data]);

  if (chartData.length === 0) {
    return (
      <p className="py-8 text-center text-muted-foreground text-sm">
        No data available
      </p>
    );
  }

  const newKey = display === "count" ? "newCount" : "newPct";
  const returningKey = display === "count" ? "returningCount" : "returningPct";
  const communityKey = display === "count" ? "communityCount" : "communityPct";

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <ToggleGroup
          type="single"
          value={display}
          onValueChange={(v) => {
            if (v) setDisplay(v as Display);
          }}
          size="sm"
          variant="outline"
        >
          <ToggleGroupItem value="count" aria-label="Show counts">
            Count
          </ToggleGroupItem>
          <ToggleGroupItem value="percent" aria-label="Show percent">
            %
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <ChartContainer config={chartConfig} className="h-[300px] w-full">
        <BarChart data={chartData} margin={{ bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10 }}
            tickFormatter={(v) => {
              if (bucket === "month") return v;
              return String(v).length > 14 ? String(v).slice(0, 14) + "…" : v;
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
            domain={display === "percent" ? [0, 100] : undefined}
            tickFormatter={display === "percent" ? (v) => `${v}%` : undefined}
            allowDecimals={false}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              if (!d) return null;
              return (
                <div className="rounded border bg-background p-2 text-sm shadow-sm">
                  <p className="font-medium">{d.label}</p>
                  <p className="text-muted-foreground">Total: {d.totalCount}</p>
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
          <Bar
            dataKey={newKey}
            stackId="stack"
            fill="var(--color-newCount)"
            name="New"
          />
          <Bar
            dataKey={returningKey}
            stackId="stack"
            fill="var(--color-returningCount)"
            name="Returning"
          />
          <Bar
            dataKey={communityKey}
            stackId="stack"
            fill="var(--color-communityCount)"
            radius={[4, 4, 0, 0]}
            name="Community"
          />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
