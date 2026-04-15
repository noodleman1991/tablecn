"use client";

import { Check, X } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getAttendeeEventHistory } from "../returning-actions";
import type { AttendeeHistoryEntry } from "../types";

interface Props {
  email: string;
  name: string;
  isCommunityMember: boolean;
}

export function AttendeeHistoryPopover({
  email,
  name,
  isCommunityMember,
}: Props) {
  const [history, setHistory] = React.useState<AttendeeHistoryEntry[] | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setError(null);
    getAttendeeEventHistory(email)
      .then((h) => {
        if (!cancelled) setHistory(h);
      })
      .catch((e: unknown) => {
        console.error("Failed to load attendee history:", e);
        if (!cancelled) setError("Failed to load event history");
      });
    return () => {
      cancelled = true;
    };
  }, [email]);

  return (
    <div className="w-80 max-w-[90vw]">
      <div className="space-y-1 border-b pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium leading-tight">{name || email}</p>
            <p className="break-all text-muted-foreground text-xs">{email}</p>
          </div>
          {isCommunityMember && <Badge variant="secondary">Community</Badge>}
        </div>
      </div>

      <div className="max-h-64 overflow-y-auto pt-2">
        <p className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Event history
        </p>
        {error ? (
          <p className="text-destructive text-xs">{error}</p>
        ) : history === null ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        ) : history.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No event records found.
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {history.map((h) => (
              <li key={h.eventId} className="flex items-start gap-2">
                <span className="mt-0.5" aria-hidden="true">
                  {h.checkedIn ? (
                    <Check className="size-3.5 text-green-600" />
                  ) : (
                    <X className="size-3.5 text-muted-foreground" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{h.eventName}</span>
                  <span className="block text-muted-foreground text-xs">
                    {formatDate(h.eventDate)}
                    {!h.checkedIn && " · bought, did not check in"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
