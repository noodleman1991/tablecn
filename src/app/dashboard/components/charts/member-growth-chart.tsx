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
  newCommunityMembers: { label: "New Community Members", color: "var(--chart-2)" },
  cumulativeCommunityMembers: { label: "Total Community Members", color: "var(--chart-1)" },
} satisfies ChartConfig;

interface Props {
  data: Array<{ month: string; newCommunityMembers: number; cumulativeCommunityMembers: number }>;
}

export function CommunityGrowthChart({ data }: Props) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No data available</p>;
  }

  return (
    <ChartContainer config={chartConfig} className="h-[300px] w-full">
      <ComposedChart data={data}>
        <XAxis dataKey="month" tick={{ fontSize: 11 }} interval={0} />
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
                <p>New community members: {d.newCommunityMembers}</p>
                <p>Total community members: {d.cumulativeCommunityMembers}</p>
              </div>
            );
          }}
        />
        <Legend />
        <Bar
          yAxisId="left"
          dataKey="newCommunityMembers"
          fill="var(--color-newCommunityMembers)"
          radius={[4, 4, 0, 0]}
          name="New Community Members"
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="cumulativeCommunityMembers"
          stroke="var(--color-cumulativeCommunityMembers)"
          strokeWidth={2}
          dot={{ r: 3 }}
          name="Total Community Members"
        />
      </ComposedChart>
    </ChartContainer>
  );
}
