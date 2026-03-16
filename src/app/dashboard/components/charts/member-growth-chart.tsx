"use client";

import {
  Bar,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

const chartConfig = {
  newMembers: { label: "New Members", color: "var(--chart-2)" },
  cumulativeMembers: { label: "Total Members", color: "var(--chart-1)" },
} satisfies ChartConfig;

interface Props {
  data: Array<{ month: string; newMembers: number; cumulativeMembers: number }>;
}

export function MemberGrowthChart({ data }: Props) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No data available</p>;
  }

  return (
    <ChartContainer config={chartConfig} className="h-[300px] w-full">
      <ComposedChart data={data}>
        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 11 }}
          allowDecimals={false}
          label={{ value: "New", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fontSize: 11 }}
          allowDecimals={false}
          label={{ value: "Total", angle: 90, position: "insideRight", style: { fontSize: 11 } }}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0]?.payload;
            return (
              <div className="rounded border bg-background p-2 text-sm shadow-sm">
                <p className="font-medium">{d.month}</p>
                <p>New members: {d.newMembers}</p>
                <p>Total members: {d.cumulativeMembers}</p>
              </div>
            );
          }}
        />
        <Legend />
        <Bar
          yAxisId="left"
          dataKey="newMembers"
          fill="var(--color-newMembers)"
          radius={[4, 4, 0, 0]}
          name="New Members"
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="cumulativeMembers"
          stroke="var(--color-cumulativeMembers)"
          strokeWidth={2}
          dot={{ r: 3 }}
          name="Total Members"
        />
      </ComposedChart>
    </ChartContainer>
  );
}
