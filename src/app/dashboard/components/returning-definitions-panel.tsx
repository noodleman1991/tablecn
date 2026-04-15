"use client";

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
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-base">
              How these metrics are calculated
            </h3>
            <p className="text-muted-foreground text-xs">
              Definitions apply to every chart in this section.
            </p>
          </div>
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => {
              if (v) onModeChange(v as ReturningMode);
            }}
            size="sm"
            variant="outline"
          >
            <ToggleGroupItem value="attendance" aria-label="Attendance-based">
              Attendance-based
            </ToggleGroupItem>
            <ToggleGroupItem value="purchase" aria-label="Purchase-based">
              Purchase-based
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium">New attendee</dt>
            <dd className="text-muted-foreground">
              First time attending a Kairos event in the selected period.
              Identified by email (case-insensitive).
            </dd>
          </div>
          <div>
            <dt className="font-medium">Returning attendee</dt>
            <dd className="text-muted-foreground">
              Has attended at least one earlier Kairos event (before the current
              event&apos;s date). Excludes community members, who are counted
              separately.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Community member</dt>
            <dd className="text-muted-foreground">
              Returning attendee currently marked as an active community member.
            </dd>
          </div>
          <div>
            <dt className="font-medium">
              Denominator (&ldquo;all ticket holders&rdquo;)
            </dt>
            <dd className="text-muted-foreground">
              {mode === "attendance" ? (
                <>
                  All <span className="font-medium">checked-in</span> attendees
                  for the event. Tickets bought but never checked in are not
                  counted.
                </>
              ) : (
                <>
                  All ticket <span className="font-medium">purchasers</span> for
                  the event, regardless of whether they checked in.
                </>
              )}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="font-medium">Excluded orders</dt>
            <dd className="text-muted-foreground">
              Cancelled, refunded, soft-deleted, and payment-failed orders.
              Merged duplicate events are also excluded &mdash; only the
              surviving event counts.
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
