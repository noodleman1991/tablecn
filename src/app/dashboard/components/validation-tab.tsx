"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { runQuickValidation, runDeepValidation, getLastValidationRuns } from "../actions";
import type { PeriodFilter, ValidationRunResult } from "../types";
import { ValidationResultCard } from "./validation-result-card";

interface ValidationTabProps {
  period: PeriodFilter;
}

export function ValidationTab({ period }: ValidationTabProps) {
  const [mode, setMode] = React.useState<"quick" | "deep">("quick");
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<ValidationRunResult | null>(null);
  const [lastRuns, setLastRuns] = React.useState<ValidationRunResult[]>([]);
  const [loadingHistory, setLoadingHistory] = React.useState(true);

  React.useEffect(() => {
    getLastValidationRuns(5)
      .then(setLastRuns)
      .catch(console.error)
      .finally(() => setLoadingHistory(false));
  }, []);

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res =
        mode === "quick"
          ? await runQuickValidation(period)
          : await runDeepValidation(period);
      setResult(res);
      // Refresh history
      const runs = await getLastValidationRuns(5);
      setLastRuns(runs);
    } catch (err) {
      console.error("Validation failed:", err);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Data Validation</CardTitle>
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
          {running && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {mode === "deep"
                  ? "Running deep validation (includes WooCommerce API calls)..."
                  : "Running quick validation..."}
              </p>
              <Progress className="h-2" />
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
