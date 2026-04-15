"use client";

import { Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ReturningMode } from "../types";

interface Props {
  mode: ReturningMode;
  onModeChange: (mode: ReturningMode) => void;
}

export function ReturningDefinitionsPanel({ mode, onModeChange }: Props) {
  return (
    <Card className="md:col-span-2">
      <CardContent className="space-y-5 pt-6">
        <div className="flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-0.5">
            <h3 className="flex items-center gap-1.5 font-semibold text-sm">
              <Info className="size-3.5 text-muted-foreground" />
              How these metrics are calculated
            </h3>
            <p className="text-muted-foreground text-xs">
              Definitions apply to every chart in this section.
            </p>
          </div>
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(v) => {
                if (v) onModeChange(v as ReturningMode);
              }}
              size="sm"
              variant="outline"
            >
              <ToggleGroupItem
                value="attendance"
                aria-label="Count by attendance"
              >
                Attended
              </ToggleGroupItem>
              <ToggleGroupItem value="purchase" aria-label="Count by purchase">
                Purchased
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="text-muted-foreground text-xs">
              {mode === "attendance"
                ? "Counts only people who checked in."
                : "Counts all ticket buyers (check-in not required)."}
            </p>
          </div>
        </div>

        <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
          <div className="space-y-0.5">
            <dt className="font-medium">New</dt>
            <dd className="text-muted-foreground text-xs leading-relaxed">
              First-ever Kairos event in the selected period. Matched by email
              (case-insensitive).
            </dd>
          </div>
          <div className="space-y-0.5">
            <dt className="font-medium">Returning</dt>
            <dd className="text-muted-foreground text-xs leading-relaxed">
              Attended at least one earlier Kairos event. Not currently an
              active community member.
            </dd>
          </div>
          <div className="space-y-0.5">
            <dt className="font-medium">Community</dt>
            <dd className="text-muted-foreground text-xs leading-relaxed">
              Returning attendee who is currently an active community member.
            </dd>
          </div>
          <div className="space-y-0.5">
            <dt className="font-medium">
              Denominator (&ldquo;all attendees&rdquo;)
            </dt>
            <dd className="text-muted-foreground text-xs leading-relaxed">
              {mode === "attendance"
                ? "Distinct checked-in people per event (or per month, using each person's first cohort of the month)."
                : "Distinct ticket buyers per event (or per month, using each person's first cohort of the month)."}
            </dd>
          </div>
        </dl>

        <p className="border-t pt-3 text-[11px] text-muted-foreground leading-relaxed">
          Excludes cancelled, refunded, soft-deleted, and payment-failed orders,
          and merged duplicate events. Monthly view uses first-cohort-per-month
          so each person is classified once per month.
        </p>
      </CardContent>
    </Card>
  );
}
