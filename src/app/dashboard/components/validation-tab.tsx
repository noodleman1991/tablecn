"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runQuickValidation, getLastValidationRuns, getResyncHistory } from "../actions";
import { resyncAllEvents, resyncFromOffset, resyncByPeriod, getBatchStatus } from "@/app/actions";
import type { PeriodFilter, ValidationCheck, ValidationRunResult } from "../types";
import type { BatchJobState } from "@/lib/batch-processor";
import type { ResyncRun } from "@/db/schema";
import { ValidationResultCard } from "./validation-result-card";

const QUICK_CHECK_NAMES = [
  "Order Capture",
  "Ticket Extraction",
  "Check-in to Members",
  "Membership Calculation",
  "Active Status Accuracy",
  "Data Quality",
  "Revenue Audit",
];

const DEEP_CHECK_NAMES = [
  ...QUICK_CHECK_NAMES,
  "WC/DB Order Reconciliation",
  "Revenue Comparison",
  "Order Status Sync",
];

interface ValidationTabProps {
  period: PeriodFilter;
}

export function ValidationTab({ period }: ValidationTabProps) {
  const [mode, setMode] = React.useState<"quick" | "deep">("quick");
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<ValidationRunResult | null>(null);
  const [lastRuns, setLastRuns] = React.useState<ValidationRunResult[]>([]);
  const [loadingHistory, setLoadingHistory] = React.useState(true);
  const [completedChecks, setCompletedChecks] = React.useState<ValidationCheck[]>([]);
  const [currentPhase, setCurrentPhase] = React.useState<"idle" | "quick" | "deep">("idle");

  // Resync state
  const [isResyncing, setIsResyncing] = React.useState(false);
  const [resyncJobs, setResyncJobs] = React.useState<{
    eventResync: BatchJobState | null;
    membershipSync: BatchJobState | null;
    loopsSync: BatchJobState | null;
  }>({ eventResync: null, membershipSync: null, loopsSync: null });
  const resyncIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const [resyncHistory, setResyncHistory] = React.useState<ResyncRun[]>([]);
  const [resyncPeriodFrom, setResyncPeriodFrom] = React.useState("");
  const [resyncPeriodTo, setResyncPeriodTo] = React.useState("");
  const [resyncFromEvent, setResyncFromEvent] = React.useState("");

  const pollResyncStatus = React.useCallback(async () => {
    const [eventResync, membershipSync, loopsSync] = await Promise.all([
      getBatchStatus("event-resync"),
      getBatchStatus("membership-sync"),
      getBatchStatus("loops-sync"),
    ]);
    setResyncJobs({ eventResync, membershipSync, loopsSync });

    const anyRunning = eventResync?.status === "running" || membershipSync?.status === "running" || loopsSync?.status === "running";
    if (!anyRunning && (eventResync || membershipSync || loopsSync)) {
      if (resyncIntervalRef.current) {
        clearInterval(resyncIntervalRef.current);
        resyncIntervalRef.current = null;
      }
      setIsResyncing(false);
      getResyncHistory(10).then(setResyncHistory).catch(console.error);
    }
  }, []);

  // Check for running jobs on mount and load history
  React.useEffect(() => {
    pollResyncStatus().then(() => {
      const hasRunning = resyncJobs.eventResync?.status === "running" ||
        resyncJobs.membershipSync?.status === "running" ||
        resyncJobs.loopsSync?.status === "running";
      if (hasRunning) {
        setIsResyncing(true);
        resyncIntervalRef.current = setInterval(pollResyncStatus, 5000);
      }
    });
    getResyncHistory(10).then(setResyncHistory).catch(console.error);
    return () => {
      if (resyncIntervalRef.current) clearInterval(resyncIntervalRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startPolling = () => {
    resyncIntervalRef.current = setInterval(pollResyncStatus, 5000);
    setTimeout(pollResyncStatus, 2000);
  };

  const handleResync = async () => {
    setIsResyncing(true);
    try {
      const result = await resyncAllEvents();
      if (!result.success) {
        toast.error(`Failed to start re-sync: ${result.error ?? "Unknown error"}`);
        setIsResyncing(false);
        return;
      }
      toast.success("Re-sync started. This runs in the background and may take several hours.");
      startPolling();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start re-sync");
      setIsResyncing(false);
    }
  };

  React.useEffect(() => {
    getLastValidationRuns(5)
      .then(setLastRuns)
      .catch(console.error)
      .finally(() => setLoadingHistory(false));
  }, []);

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    setCompletedChecks([]);
    setCurrentPhase("quick");

    try {
      // Phase 1: Quick validation (server action, fast)
      const quickResult = await runQuickValidation(period);
      setCompletedChecks(quickResult.checks);

      if (mode === "quick") {
        setResult(quickResult);
      } else {
        // Phase 2: Deep validation via API route (extended timeout)
        setCurrentPhase("deep");
        const res = await fetch("/api/validation/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "deep", period }),
        });
        if (!res.ok) throw new Error("Deep validation failed");
        const deepResult = (await res.json()) as ValidationRunResult;
        setCompletedChecks(deepResult.checks);
        setResult(deepResult);
      }

      const runs = await getLastValidationRuns(5);
      setLastRuns(runs);
    } catch (err) {
      console.error("Validation failed:", err);
    } finally {
      setRunning(false);
      setCurrentPhase("idle");
    }
  };

  const checkNames = mode === "deep" ? DEEP_CHECK_NAMES : QUICK_CHECK_NAMES;

  const resyncJobRows = [
    { label: "Syncing events from WooCommerce", state: resyncJobs.eventResync },
    { label: "Recalculating memberships", state: resyncJobs.membershipSync },
    { label: "Syncing to Loops.so", state: resyncJobs.loopsSync },
  ].filter((j) => j.state !== null);

  const lastFailedJob = [resyncJobs.eventResync, resyncJobs.membershipSync, resyncJobs.loopsSync]
    .find((j) => j?.status === "failed");

  return (
    <div className="space-y-4">
      {/* Re-sync Card */}
      <Card>
        <CardHeader>
          <CardTitle>WooCommerce Re-sync</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Pulls latest ticket data from WooCommerce, recalculates memberships, and syncs contacts to Loops.so. Runs in the background — a full resync may take several hours.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Resync options */}
          <div className="flex flex-wrap gap-3 items-end">
            <Button
              onClick={handleResync}
              disabled={isResyncing}
              size="sm"
              className="gap-2"
            >
              <RefreshCw className={`size-4 ${isResyncing ? "animate-spin" : ""}`} />
              {isResyncing ? "Re-syncing..." : "Re-sync All Events"}
            </Button>

            <div className="flex items-end gap-2">
              <div>
                <Label className="text-xs">From event #</Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="0"
                  value={resyncFromEvent}
                  onChange={(e) => setResyncFromEvent(e.target.value)}
                  className="w-[80px] h-8"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={isResyncing || !resyncFromEvent}
                onClick={async () => {
                  const offset = parseInt(resyncFromEvent);
                  if (isNaN(offset) || offset < 0) return;
                  setIsResyncing(true);
                  try {
                    const result = await resyncFromOffset(offset);
                    if (!result.success) {
                      toast.error(`Failed: ${result.error ?? "Unknown error"}`);
                      setIsResyncing(false);
                      return;
                    }
                    toast.success(`Resuming from event #${offset}...`);
                    startPolling();
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Failed");
                    setIsResyncing(false);
                  }
                }}
              >
                Resume
              </Button>
            </div>

            <div className="flex items-end gap-2">
              <div>
                <Label className="text-xs">Period from</Label>
                <Input
                  type="date"
                  value={resyncPeriodFrom}
                  onChange={(e) => setResyncPeriodFrom(e.target.value)}
                  className="w-[140px] h-8"
                />
              </div>
              <div>
                <Label className="text-xs">to</Label>
                <Input
                  type="date"
                  value={resyncPeriodTo}
                  onChange={(e) => setResyncPeriodTo(e.target.value)}
                  className="w-[140px] h-8"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={isResyncing || !resyncPeriodFrom || !resyncPeriodTo}
                onClick={async () => {
                  if (!resyncPeriodFrom || !resyncPeriodTo) return;
                  setIsResyncing(true);
                  try {
                    const result = await resyncByPeriod(resyncPeriodFrom, resyncPeriodTo);
                    if (!result.success) {
                      toast.error(`Failed: ${result.error ?? "Unknown error"}`);
                      setIsResyncing(false);
                      return;
                    }
                    toast.success(`Re-syncing events from ${resyncPeriodFrom} to ${resyncPeriodTo}...`);
                    startPolling();
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Failed");
                    setIsResyncing(false);
                  }
                }}
              >
                Sync period
              </Button>
            </div>
          </div>

          {/* Live progress */}
          {resyncJobRows.length > 0 && (
            <div className="space-y-3">
              {resyncJobRows.map(({ label, state }) => {
                if (!state) return null;
                const pct = state.total > 0 ? Math.round((state.processed / state.total) * 100) : 0;
                return (
                  <div key={state.type} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground tabular-nums">
                          {state.processed} / {state.total}
                        </span>
                        {state.errors > 0 && (
                          <span className="text-destructive text-xs">
                            ({state.errors} {state.errors === 1 ? "error" : "errors"})
                          </span>
                        )}
                        <Badge
                          variant="outline"
                          className={
                            state.status === "running"
                              ? "border-blue-300 text-blue-700"
                              : state.status === "completed"
                              ? "border-green-300 text-green-700"
                              : "border-red-300 text-red-700"
                          }
                        >
                          {state.status === "running" ? "Running" : state.status === "completed" ? "Completed" : "Failed"}
                        </Badge>
                      </div>
                    </div>
                    <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          state.status === "failed" ? "bg-destructive" : "bg-primary"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {lastFailedJob && (
                <div className="flex items-center justify-between gap-2 rounded border border-destructive/30 bg-destructive/5 p-2">
                  <p className="text-xs text-destructive">
                    Failed at event {lastFailedJob.processed} of {lastFailedJob.total}.
                    {lastFailedJob.error && ` Error: ${lastFailedJob.error}`}
                  </p>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7"
                      disabled={isResyncing}
                      onClick={async () => {
                        setIsResyncing(true);
                        try {
                          const result = await resyncFromOffset(lastFailedJob.processed);
                          if (!result.success) {
                            toast.error(`Failed: ${result.error ?? "Unknown error"}`);
                            setIsResyncing(false);
                            return;
                          }
                          toast.success(`Resuming from event ${lastFailedJob.processed}...`);
                          startPolling();
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : "Failed");
                          setIsResyncing(false);
                        }
                      }}
                    >
                      Resume from #{lastFailedJob.processed}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7"
                      disabled={isResyncing}
                      onClick={handleResync}
                    >
                      Restart
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Persistent history */}
          {resyncHistory.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Resync History</p>
              <div className="space-y-1.5">
                {resyncHistory.map((run) => (
                  <div key={run.id} className="flex items-center justify-between text-xs rounded border p-2">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={
                          run.status === "completed"
                            ? "border-green-300 text-green-700 text-[10px]"
                            : "border-red-300 text-red-700 text-[10px]"
                        }
                      >
                        {run.status}
                      </Badge>
                      <span className="text-muted-foreground">
                        {new Date(run.completedAt).toLocaleString("en-GB", {
                          day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums">{run.processed}/{run.total} events</span>
                      {run.errors > 0 && (
                        <span className="text-destructive">({run.errors} errors)</span>
                      )}
                      {run.startOffset > 0 && (
                        <span className="text-muted-foreground">(from #{run.startOffset})</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Validation Card */}
      <Card className="opacity-60">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Data Validation
              <Badge variant="outline" className="text-xs font-normal">WIP</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Validation is read-only — it analyzes data but never modifies records.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              <Button
                variant={mode === "quick" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("quick")}
                disabled
              >
                Quick
              </Button>
              <Button
                variant={mode === "deep" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("deep")}
                disabled
              >
                Deep
              </Button>
            </div>
            <Button onClick={handleRun} disabled size="sm">
              Run Validation
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            {mode === "quick"
              ? "Database checks only. Verifies data integrity using local records. ~5 seconds, 7 checks."
              : "Includes all Quick checks + live WooCommerce comparison. ~30-60 seconds, 10 checks."}
          </p>

          {running && (
            <div className="space-y-1 mb-4">
              {checkNames.map((name) => {
                const completed = completedChecks.find((c) => c.name === name);
                const isDeepCheck = !QUICK_CHECK_NAMES.includes(name);
                const isWaiting = !completed && (isDeepCheck ? currentPhase !== "deep" : currentPhase === "idle");
                const isRunning = !completed && !isWaiting;

                return (
                  <div key={name} className="flex items-center gap-2 text-sm py-0.5">
                    {completed ? (
                      <span className={
                        completed.status === "pass"
                          ? "text-green-600"
                          : completed.status === "warn"
                          ? "text-yellow-600"
                          : "text-red-600"
                      }>
                        {completed.status === "pass" ? "\u2713" : completed.status === "warn" ? "\u26A0" : "\u2717"}
                      </span>
                    ) : isRunning ? (
                      <span className="text-blue-500 animate-pulse">\u25CF</span>
                    ) : (
                      <span className="text-muted-foreground">\u25CB</span>
                    )}
                    <span className={completed ? "" : isRunning ? "text-foreground" : "text-muted-foreground"}>
                      {name}
                    </span>
                    {completed && completed.count > 0 && (
                      <span className="text-xs text-muted-foreground">({completed.count})</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {result && !running && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Badge variant="outline" className="border-green-500 bg-green-50 text-green-700">
                  {result.summary.passed} passed
                </Badge>
                {result.summary.warnings > 0 && (
                  <Badge variant="outline" className="border-yellow-500 bg-yellow-50 text-yellow-700">
                    {result.summary.warnings} warnings
                  </Badge>
                )}
                {result.summary.failures > 0 && (
                  <Badge variant="outline" className="border-red-500 bg-red-50 text-red-700">
                    {result.summary.failures} failures
                  </Badge>
                )}
              </div>

              <Accordion type="multiple" className="w-full">
                {result.checks.map((check, i) => (
                  <ValidationResultCard key={i} check={check} index={i} />
                ))}
              </Accordion>
            </div>
          )}

          {!result && !running && (
            <p className="text-sm text-muted-foreground">
              Run a validation to check data integrity for the selected period.
            </p>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Runs</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingHistory ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : lastRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No previous runs.</p>
          ) : (
            <div className="space-y-2">
              {lastRuns.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between rounded border p-2 text-sm cursor-pointer hover:bg-muted/50"
                  onClick={() => setResult(run)}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {run.mode}
                    </Badge>
                    <span>
                      {new Date(run.runAt).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <Badge variant="outline" className="border-green-500 text-green-700 text-xs">
                      {run.summary.passed}
                    </Badge>
                    {run.summary.warnings > 0 && (
                      <Badge variant="outline" className="border-yellow-500 text-yellow-700 text-xs">
                        {run.summary.warnings}
                      </Badge>
                    )}
                    {run.summary.failures > 0 && (
                      <Badge variant="outline" className="border-red-500 text-red-700 text-xs">
                        {run.summary.failures}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
