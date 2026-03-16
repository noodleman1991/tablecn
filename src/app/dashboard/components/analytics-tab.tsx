"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getAnalyticsData } from "../actions";
import type { PeriodFilter, AnalyticsData } from "../types";

const AttendanceTrendChart = dynamic(
  () => import("./charts/attendance-trend-chart").then((m) => m.AttendanceTrendChart),
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
const TopBuyersChart = dynamic(
  () => import("./charts/top-buyers-chart").then((m) => m.TopBuyersChart),
  { ssr: false, loading: () => <Skeleton className="h-[300px] w-full" /> },
);
const NewVsReturningChart = dynamic(
  () => import("./charts/new-vs-returning-chart").then((m) => m.NewVsReturningChart),
  { ssr: false, loading: () => <Skeleton className="h-[300px] w-full" /> },
);
const MemberGrowthPerEventChart = dynamic(
  () => import("./charts/member-growth-per-event-chart").then((m) => m.MemberGrowthPerEventChart),
  { ssr: false, loading: () => <Skeleton className="h-[300px] w-full" /> },
);
const MemberGrowthChart = dynamic(
  () => import("./charts/member-growth-chart").then((m) => m.MemberGrowthChart),
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

    return () => { cancelled = true; };
  }, [period]);

  if (loading || !data) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 8 }).map((_, i) => (
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
          <CardTitle className="text-base">New Members per Event</CardTitle>
        </CardHeader>
        <CardContent>
          <MemberGrowthPerEventChart data={data.memberGrowthPerEvent} />
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Events by Attendance</CardTitle>
        </CardHeader>
        <CardContent>
          <TopEventsChart data={data.topEvents} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Buyers by Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <TopBuyersChart data={data.topBuyers} />
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">New vs Returning Attendees</CardTitle>
        </CardHeader>
        <CardContent>
          <NewVsReturningChart data={data.newVsReturning} />
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Member Growth</CardTitle>
        </CardHeader>
        <CardContent>
          <MemberGrowthChart data={data.memberGrowth} />
        </CardContent>
      </Card>
    </div>
  );
}
