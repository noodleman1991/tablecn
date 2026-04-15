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
      const denom = r.newCount + r.returningCount + r.communityCount;
      if (denom === 0) {
        return {
          label: r.bucketLabel,
          bucket: r.bucket,
          newCount: r.newCount,
          returningCount: r.returningCount,
          communityCount: r.communityCount,
          totalCount: r.totalCount,
          newPct: 0,
          returningPct: 0,
          communityPct: 0,
        };
      }
      // Largest Remainder Method — guarantees the three integer percentages
      // always sum to exactly 100, regardless of rounding direction.
      const exactNew = (r.newCount / denom) * 100;
      const exactRet = (r.returningCount / denom) * 100;
      const exactCom = (r.communityCount / denom) * 100;
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
        label: r.bucketLabel,
        bucket: r.bucket,
        newCount: r.newCount,
        returningCount: r.returningCount,
        communityCount: r.communityCount,
        totalCount: r.totalCount,
        newPct: flNew,
        returningPct: flRet,
        communityPct: flCom,
      };
    });
  }, [data]);

  const fmtPct = (v: number) => `${v}%`;

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
            tickFormatter={
              display === "percent"
                ? (v) => `${Math.round(v)}%`
                : undefined
            }
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
                    New: {d.newCount} ({fmtPct(d.newPct)})
                  </p>
                  <p style={{ color: "var(--chart-3)" }}>
                    Returning: {d.returningCount} ({fmtPct(d.returningPct)})
                  </p>
                  <p style={{ color: "var(--chart-4)" }}>
                    Community: {d.communityCount} ({fmtPct(d.communityPct)})
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
