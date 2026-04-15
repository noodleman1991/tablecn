"use client";

import { AlertTriangle, Download, X } from "lucide-react";
import dynamic from "next/dynamic";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  downloadCSV,
  exportReturningAttendeesToCSV,
  generateReturningFilename,
} from "@/lib/csv-export";
import { getReturningAttendeesForExport } from "../actions";
import {
  getNewVsReturningEnhanced,
  getRetentionRateTrend,
  getSuperAttendees,
} from "../returning-actions";
import type {
  AnalyticsData,
  CohortRow,
  PeriodFilter,
  ReturningMode,
  SuperAttendee,
} from "../types";
import { ReturningDefinitionsPanel } from "./returning-definitions-panel";
import { SuperAttendeesLeaderboard } from "./super-attendees-leaderboard";

const RetentionRateTrendChart = dynamic(
  () =>
    import("./charts/retention-rate-trend-chart").then(
      (m) => m.RetentionRateTrendChart,
    ),
  { ssr: false, loading: () => <Skeleton className="h-[320px] w-full" /> },
);

const NewVsReturningChart = dynamic(
  () =>
    import("./charts/new-vs-returning-chart").then(
      (m) => m.NewVsReturningChart,
    ),
  { ssr: false, loading: () => <Skeleton className="h-[300px] w-full" /> },
);

const AttendeeBreakdownChart = dynamic(
  () =>
    import("./charts/attendee-breakdown-chart").then(
      (m) => m.AttendeeBreakdownChart,
    ),
  { ssr: false, loading: () => <Skeleton className="h-[300px] w-full" /> },
);

interface Props {
  period: PeriodFilter;
  /** Existing analytics data — the Attendee Breakdown chart reuses it. */
  analytics: Pick<
    AnalyticsData,
    "attendeeBreakdownByEvent" | "attendeeBreakdownByMonth"
  >;
}

export function ReturningSection({ period, analytics }: Props) {
  const [mode, setMode] = React.useState<ReturningMode>("attendance");
  const [trendBucket, setTrendBucket] = React.useState<"event" | "month">(
    "event",
  );
  const [nvrBucket, setNvrBucket] = React.useState<"event" | "month">("event");

  const [retentionData, setRetentionData] = React.useState<CohortRow[] | null>(
    null,
  );
  const [nvrData, setNvrData] = React.useState<CohortRow[] | null>(null);
  const [leaderboard, setLeaderboard] = React.useState<SuperAttendee[] | null>(
    null,
  );
  const [bannerDismissed, setBannerDismissed] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);

  // Fetch retention trend when period/mode/bucket change
  React.useEffect(() => {
    let cancelled = false;
    setRetentionData(null);
    getRetentionRateTrend(period, mode, trendBucket)
      .then((d) => {
        if (!cancelled) setRetentionData(d);
      })
      .catch((e) =>
        console.error("[returning] retention trend load failed:", e),
      );
    return () => {
      cancelled = true;
    };
  }, [period, mode, trendBucket]);

  // Fetch new-vs-returning when period/mode/bucket change
  React.useEffect(() => {
    let cancelled = false;
    setNvrData(null);
    getNewVsReturningEnhanced(period, mode, nvrBucket)
      .then((d) => {
        if (!cancelled) setNvrData(d);
      })
      .catch((e) =>
        console.error("[returning] new-vs-returning load failed:", e),
      );
    return () => {
      cancelled = true;
    };
  }, [period, mode, nvrBucket]);

  // Fetch leaderboard when period/mode change
  React.useEffect(() => {
    let cancelled = false;
    setLeaderboard(null);
    getSuperAttendees(period, mode, 20)
      .then((d) => {
        if (!cancelled) setLeaderboard(d);
      })
      .catch((e) => console.error("[returning] leaderboard load failed:", e));
    return () => {
      cancelled = true;
    };
  }, [period, mode]);

  // Reset dismissed banner when mode/period changes
  React.useEffect(() => {
    setBannerDismissed(false);
  }, [mode, period]);

  const hasMismatch = React.useMemo(() => {
    const rowsA = retentionData ?? [];
    const rowsB = nvrData ?? [];
    return rowsA.some((r) => r.hasMismatch) || rowsB.some((r) => r.hasMismatch);
  }, [retentionData, nvrData]);

  const handleDownloadCSV = async () => {
    setDownloading(true);
    try {
      const attendees = await getReturningAttendeesForExport(period);
      if (attendees.length === 0) {
        toast.error("No returning attendees found for this period");
        return;
      }
      const csv = exportReturningAttendeesToCSV(attendees);
      const fromDate =
        period.from instanceof Date ? period.from : new Date(period.from);
      const toDate =
        period.to instanceof Date ? period.to : new Date(period.to);
      const filename = generateReturningFilename(fromDate, toDate);
      downloadCSV(csv, filename);
      toast.success(`Downloaded ${attendees.length} returning attendees`);
    } catch (err) {
      console.error("Failed to export returning attendees:", err);
      toast.error("Failed to export returning attendees");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <div className="mt-2 md:col-span-2">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-lg">Returning Attendees</h2>
          <div className="flex-1 border-t" />
        </div>
        <p className="mt-1 text-muted-foreground text-xs">
          Who&apos;s coming back, who&apos;s brand new, and how loyal your
          audience is.
        </p>
      </div>

      {hasMismatch && !bannerDismissed && (
        <div className="flex items-start gap-3 rounded border border-destructive/60 bg-destructive/10 p-3 md:col-span-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-destructive">
              Data consistency warning
            </p>
            <p className="text-muted-foreground">
              One or more events have cohort sums that don&apos;t match the
              total attendee count. Check server logs for details, then re-sync
              affected events.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setBannerDismissed(true)}
            className="h-6 w-6 shrink-0 p-0"
            aria-label="Dismiss warning"
          >
            <X className="size-4" />
          </Button>
        </div>
      )}

      <ReturningDefinitionsPanel mode={mode} onModeChange={setMode} />

      <Card className="md:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Retention Rate Trend</CardTitle>
          <ToggleGroup
            type="single"
            value={trendBucket}
            onValueChange={(v) => {
              if (v) setTrendBucket(v as "event" | "month");
            }}
            size="sm"
            variant="outline"
          >
            <ToggleGroupItem value="event">By Event</ToggleGroupItem>
            <ToggleGroupItem value="month">By Month</ToggleGroupItem>
          </ToggleGroup>
        </CardHeader>
        <CardContent>
          {retentionData === null ? (
            <Skeleton className="h-[320px] w-full" />
          ) : (
            <RetentionRateTrendChart
              data={retentionData}
              bucket={trendBucket}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Super-Attendees Leaderboard
          </CardTitle>
          <p className="text-muted-foreground text-xs">
            Most frequent attendees in the selected period (min. 2 events).
          </p>
        </CardHeader>
        <CardContent>
          <SuperAttendeesLeaderboard data={leaderboard} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">New vs Returning</CardTitle>
          <ToggleGroup
            type="single"
            value={nvrBucket}
            onValueChange={(v) => {
              if (v) setNvrBucket(v as "event" | "month");
            }}
            size="sm"
            variant="outline"
          >
            <ToggleGroupItem value="event">By Event</ToggleGroupItem>
            <ToggleGroupItem value="month">By Month</ToggleGroupItem>
          </ToggleGroup>
        </CardHeader>
        <CardContent>
          {nvrData === null ? (
            <Skeleton className="h-[300px] w-full" />
          ) : (
            <NewVsReturningChart data={nvrData} bucket={nvrBucket} />
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Attendee Breakdown</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadCSV}
            disabled={downloading}
          >
            <Download className="size-4" />
            <span className="hidden sm:inline">Download Returning CSV</span>
          </Button>
        </CardHeader>
        <CardContent>
          <AttendeeBreakdownChart
            byEvent={analytics.attendeeBreakdownByEvent}
            byMonth={analytics.attendeeBreakdownByMonth}
          />
        </CardContent>
      </Card>
    </>
  );
}
