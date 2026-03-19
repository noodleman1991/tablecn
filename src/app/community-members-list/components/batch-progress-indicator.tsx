"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { getBatchStatus } from "@/app/actions";
import type { BatchJobState } from "@/lib/batch-processor";

interface BatchProgressIndicatorProps {
  isActive: boolean;
}

interface JobDisplay {
  label: string;
  state: BatchJobState | null;
}

export function BatchProgressIndicator({ isActive }: BatchProgressIndicatorProps) {
  const [jobs, setJobs] = useState<{ eventResync: BatchJobState | null; membershipSync: BatchJobState | null }>({
    eventResync: null,
    membershipSync: null,
  });
  const [isPolling, setIsPolling] = useState(false);
  const [hideTimeout, setHideTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  const fetchStatuses = useCallback(async () => {
    const [eventResync, membershipSync] = await Promise.all([
      getBatchStatus("event-resync"),
      getBatchStatus("membership-sync"),
    ]);
    setJobs({ eventResync, membershipSync });
    return { eventResync, membershipSync };
  }, []);

  const startPolling = useCallback(() => {
    if (intervalRef.current) return;
    setIsPolling(true);
    setTimedOut(false);
    pollCountRef.current = 0;
    intervalRef.current = setInterval(async () => {
      pollCountRef.current += 1;
      const result = await fetchStatuses();
      const hasAnyRunningJob =
        result.eventResync?.status === "running" || result.membershipSync?.status === "running";
      const hasAnyJobData = result.eventResync || result.membershipSync;

      // Timeout: if after 4 polls (~12s) we still have no job data, give up
      if (!hasAnyJobData && pollCountRef.current >= 4) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        setTimedOut(true);
        const timeout = setTimeout(() => {
          setIsPolling(false);
          setTimedOut(false);
        }, 8000);
        setHideTimeout(timeout);
        return;
      }

      const bothTerminal = hasAnyJobData && !hasAnyRunningJob;
      if (bothTerminal) {
        // Stop polling, show result for 8 seconds then hide
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        const timeout = setTimeout(() => {
          setIsPolling(false);
          setJobs({ eventResync: null, membershipSync: null });
        }, 8000);
        setHideTimeout(timeout);
      }
    }, 3000);
  }, [fetchStatuses]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      setHideTimeout(null);
    }
  }, [hideTimeout]);

  // On mount: check once for any running jobs (handles page reload mid-job)
  useEffect(() => {
    fetchStatuses().then((result) => {
      if (result.eventResync?.status === "running" || result.membershipSync?.status === "running") {
        startPolling();
      }
    });
    return () => stopPolling();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When parent triggers resync
  useEffect(() => {
    if (isActive) {
      fetchStatuses();
      startPolling();
    }
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasAnyJob = jobs.eventResync || jobs.membershipSync;
  if (!isPolling && !hasAnyJob && !timedOut) return null;

  if (timedOut) {
    return (
      <Card>
        <CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">
            The batch job is running in the background but progress tracking is unavailable. Refresh the page later to see updated data.
          </p>
        </CardContent>
      </Card>
    );
  }

  const jobRows: JobDisplay[] = [
    { label: "Syncing events", state: jobs.eventResync },
    { label: "Recalculating memberships", state: jobs.membershipSync },
  ].filter((j) => j.state !== null);

  if (jobRows.length === 0) return null;

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        {jobRows.map(({ label, state }) => {
          if (!state) return null;
          const pct = state.total > 0 ? Math.round((state.processed / state.total) * 100) : 0;
          return (
            <div key={state.type} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{label}...</span>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground tabular-nums">
                    {state.processed} / {state.total}
                  </span>
                  {state.errors > 0 && (
                    <span className="text-destructive text-xs">
                      ({state.errors} {state.errors === 1 ? "error" : "errors"})
                    </span>
                  )}
                  <StatusBadge status={state.status} />
                </div>
              </div>
              <Progress value={pct} />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: BatchJobState["status"] }) {
  switch (status) {
    case "running":
      return <Badge variant="outline" className="border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300">Running</Badge>;
    case "completed":
      return <Badge variant="outline" className="border-green-300 text-green-700 dark:border-green-700 dark:text-green-300">Completed</Badge>;
    case "failed":
      return <Badge variant="outline" className="border-red-300 text-red-700 dark:border-red-700 dark:text-red-300">Failed</Badge>;
  }
}
