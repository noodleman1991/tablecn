"use client";

import { Bar, BarChart, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

const chartConfig = {
  newCount: { label: "New Attendees", color: "var(--chart-5)" },
} satisfies ChartConfig;

interface Props {
  data: Array<{ eventName: string; date: string; newCount: number }>;
}

export function NewAttendeesPerEventChart({ data }: Props) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No data available</p>;
  }

  return (
    <ChartContainer config={chartConfig} className="h-[300px] w-full">
      <BarChart data={data} margin={{ bottom: 20 }}>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10 }}
          tickFormatter={(v) => {
            const d = new Date(v);
            return `${d.getDate()}/${d.getMonth() + 1}`;
          }}
          angle={-45}
          textAnchor="end"
          height={60}
          interval={data.length > 30 ? Math.floor(data.length / 15) : 0}
        />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            return (
              <div className="rounded border bg-background p-2 text-sm shadow-sm">
                <p className="font-medium">{d.eventName}</p>
                <p className="text-muted-foreground">{d.date}</p>
                <p>New attendees: {d.newCount}</p>
              </div>
            );
          }}
        />
        <Bar dataKey="newCount" fill="var(--color-newCount)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
