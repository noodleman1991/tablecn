"use client";

import { Bar, BarChart, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

const chartConfig = {
  newCount: { label: "New", color: "hsl(var(--chart-1))" },
  returningCount: { label: "Returning", color: "hsl(var(--chart-2))" },
} satisfies ChartConfig;

interface Props {
  data: Array<{
    eventName: string;
    date: string;
    newCount: number;
    returningCount: number;
  }>;
}

export function NewVsReturningChart({ data }: Props) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No data available</p>;
  }

  return (
    <ChartContainer config={chartConfig} className="h-[300px] w-full">
      <BarChart data={data}>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11 }}
          tickFormatter={(v) => {
            const d = new Date(v);
            return `${d.getDate()}/${d.getMonth() + 1}`;
          }}
        />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0]?.payload;
            return (
              <div className="rounded border bg-background p-2 text-sm shadow-sm">
                <p className="font-medium">{d.eventName}</p>
                <p className="text-muted-foreground">{d.date}</p>
                <p>New: {d.newCount}</p>
                <p>Returning: {d.returningCount}</p>
              </div>
            );
          }}
        />
        <Legend />
        <Bar
          dataKey="newCount"
          fill="var(--color-newCount)"
          radius={[4, 4, 0, 0]}
          name="New"
        />
        <Bar
          dataKey="returningCount"
          fill="var(--color-returningCount)"
          radius={[4, 4, 0, 0]}
          name="Returning"
        />
      </BarChart>
    </ChartContainer>
  );
}
