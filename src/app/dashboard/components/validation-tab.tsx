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
import { runQuickValidation, getLastValidationRuns } from "../actions";
import type { PeriodFilter, ValidationCheck, ValidationRunResult } from "../types";
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Data Validation</CardTitle>
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
              >
                Quick
              </Button>
              <Button
                variant={mode === "deep" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("deep")}
              >
                Deep
              </Button>
            </div>
            <Button onClick={handleRun} disabled={running} size="sm">
              {running ? "Running..." : "Run Validation"}
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
