"use client";

import { Download } from "lucide-react";
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
  { ssr: false, loading: () => <Skeleton className="h-[320px] w-full" /> },
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
  const [nvrBucket, setNvrBucket] = React.useState<"event" | "month">("event");

  const [nvrData, setNvrData] = React.useState<CohortRow[] | null>(null);
  const [leaderboard, setLeaderboard] = React.useState<SuperAttendee[] | null>(
    null,
  );
  const [downloading, setDownloading] = React.useState(false);

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

      <ReturningDefinitionsPanel mode={mode} onModeChange={setMode} />

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Most Frequent Attendees</CardTitle>
          <p className="text-muted-foreground text-xs">
            Top 20 by events attended in the selected period (min. 2 events).
            Click a row to see their event history.
          </p>
        </CardHeader>
        <CardContent>
          <SuperAttendeesLeaderboard data={leaderboard} />
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
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
        <CardHeader className="flex flex-row items-center justify-between gap-3">
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
