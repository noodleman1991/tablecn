"use client";

import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDashboardStats } from "../actions";
import type { DashboardStats, PeriodFilter } from "../types";
import { PeriodFilterSelect } from "./period-filter";
import { StatCards } from "./stat-cards";
import { FunnelTab } from "./funnel-tab";
import { AnalyticsTab } from "./analytics-tab";
import { ValidationTab } from "./validation-tab";

interface DashboardPageProps {
  initialStats: DashboardStats;
  defaultPeriod: PeriodFilter;
}

export function DashboardPage({ initialStats, defaultPeriod }: DashboardPageProps) {
  const [period, setPeriod] = React.useState<PeriodFilter>(defaultPeriod);
  const [stats, setStats] = React.useState<DashboardStats>(initialStats);
  const [loading, setLoading] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const handlePeriodChange = (newPeriod: PeriodFilter) => {
    setPeriod(newPeriod);
    startTransition(async () => {
      setLoading(true);
      try {
        const newStats = await getDashboardStats(newPeriod);
        setStats(newStats);
      } catch (err) {
        console.error("Failed to refresh stats:", err);
      } finally {
        setLoading(false);
      }
    });
  };

  return (
    <div className="container flex flex-col gap-6 py-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Event analytics, funnel, and data validation
          </p>
        </div>
        <PeriodFilterSelect value={period} onChange={handlePeriodChange} />
      </div>

      <StatCards stats={stats} loading={loading || isPending} />

      <Tabs defaultValue="funnel" className="w-full">
        <TabsList>
          <TabsTrigger value="funnel">Funnel</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="validation">Validation</TabsTrigger>
        </TabsList>

        <TabsContent value="funnel" className="mt-4">
          <FunnelTab period={period} />
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <AnalyticsTab period={period} />
        </TabsContent>

        <TabsContent value="validation" className="mt-4">
          <ValidationTab period={period} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
