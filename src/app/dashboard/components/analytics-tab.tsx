"use client";

import dynamic from "next/dynamic";
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getAnalyticsData } from "../actions";
import type { AnalyticsData, PeriodFilter } from "../types";
import { ReturningSection } from "./returning-section";

const AttendanceTrendChart = dynamic(
  () =>
    import("./charts/attendance-trend-chart").then(
      (m) => m.AttendanceTrendChart,
    ),
  { ssr: false, loading: () => <Skeleton className="h-[300px] w-full" /> },
);

const TicketTypeChart = dynamic(
  () => import("./charts/ticket-type-chart").then((m) => m.TicketTypeChart),
  { ssr: false, loading: () => <Skeleton className="h-[300px] w-full" /> },
);
const RevenueTrendChart = dynamic(
  () => import("./charts/revenue-trend-chart").then((m) => m.RevenueTrendChart),
  { ssr: false, loading: () => <Skeleton className="h-[300px] w-full" /> },
);
const TopEventsChart = dynamic(
  () => import("./charts/top-events-chart").then((m) => m.TopEventsChart),
  { ssr: false, loading: () => <Skeleton className="h-[300px] w-full" /> },
);

interface AnalyticsTabProps {
  period: PeriodFilter;
}

export function AnalyticsTab({ period }: AnalyticsTabProps) {
  const [data, setData] = React.useState<AnalyticsData | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getAnalyticsData(period)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => console.error("Failed to load analytics:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [period]);

  if (loading || !data) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[300px] w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Attendance Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <AttendanceTrendChart data={data.attendanceTrend} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ticket Types</CardTitle>
        </CardHeader>
        <CardContent>
          <TicketTypeChart data={data.ticketTypeDistribution} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revenue Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <RevenueTrendChart data={data.revenueTrend} />
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Top Events by Attendance</CardTitle>
        </CardHeader>
        <CardContent>
          <TopEventsChart data={data.topEvents} />
        </CardContent>
      </Card>

      <ReturningSection
        period={period}
        analytics={{
          attendeeBreakdownByEvent: data.attendeeBreakdownByEvent,
          attendeeBreakdownByMonth: data.attendeeBreakdownByMonth,
        }}
      />
    </div>
  );
}
