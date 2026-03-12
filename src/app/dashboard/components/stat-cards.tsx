"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardStats } from "../types";

interface StatCardsProps {
  stats: DashboardStats;
  loading: boolean;
}

export function StatCards({ stats, loading }: StatCardsProps) {
  const cards = [
    { title: "Events", value: stats.eventsCount.toString() },
    { title: "Valid Tickets", value: stats.validTickets.toString() },
    {
      title: "Check-in Rate",
      value: `${stats.checkinRate.toFixed(1)}%`,
    },
    { title: "Active Members", value: stats.activeMembersCount.toString() },
    {
      title: "Revenue",
      value: `£${stats.totalRevenue.toLocaleString("en-GB", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })}`,
    },
  ];

  return (
    <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{card.value}</div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
