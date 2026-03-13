"use client";

import { Bar, BarChart, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

const chartConfig = {
  count: { label: "Attendance", color: "hsl(var(--chart-4))" },
} satisfies ChartConfig;

interface Props {
  data: Array<{ eventName: string; count: number }>;
}

export function TopEventsChart({ data }: Props) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No data available</p>;
  }

  return (
    <ChartContainer config={chartConfig} className="h-[300px] w-full">
      <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
        <XAxis type="number" tick={{ fontSize: 11 }} />
        <YAxis
          type="category"
          dataKey="eventName"
          tick={{ fontSize: 10 }}
          width={200}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            return (
              <div className="rounded border bg-background p-2 text-sm shadow-sm">
                <p className="font-medium">{d.eventName}</p>
                <p>{d.count} checked in</p>
              </div>
            );
          }}
        />
        <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
