"use client";

import { ArrowUpDown } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { SuperAttendee } from "../types";
import { AttendeeHistoryPopover } from "./attendee-history-popover";

type SortKey = "eventsAttended" | "lastEventDate" | "name";
type SortDir = "asc" | "desc";

interface Props {
  data: SuperAttendee[] | null;
}

export function SuperAttendeesLeaderboard({ data }: Props) {
  const [sortKey, setSortKey] = React.useState<SortKey>("eventsAttended");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");

  const sorted = React.useMemo(() => {
    if (!data) return null;
    const copy = [...data];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "eventsAttended") {
        cmp = a.eventsAttended - b.eventsAttended;
      } else if (sortKey === "lastEventDate") {
        cmp = a.lastEventDate.localeCompare(b.lastEventDate);
      } else {
        const an = `${a.firstName} ${a.lastName}`.trim() || a.email;
        const bn = `${b.firstName} ${b.lastName}`.trim() || b.email;
        cmp = an.localeCompare(bn);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [data, sortKey, sortDir]);

  const maxEvents = React.useMemo(() => {
    if (!sorted || sorted.length === 0) return 1;
    return Math.max(...sorted.map((s) => s.eventsAttended), 1);
  }, [sorted]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  if (data === null) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (sorted && sorted.length === 0) {
    return (
      <p className="py-8 text-center text-muted-foreground text-sm">
        No repeat attendees in the selected period.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b px-2 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        <SortButton
          label="Attendee"
          active={sortKey === "name"}
          dir={sortDir}
          onClick={() => toggleSort("name")}
        />
        <SortButton
          label="Events"
          active={sortKey === "eventsAttended"}
          dir={sortDir}
          onClick={() => toggleSort("eventsAttended")}
          className="justify-end"
        />
        <SortButton
          label="Last seen"
          active={sortKey === "lastEventDate"}
          dir={sortDir}
          onClick={() => toggleSort("lastEventDate")}
          className="justify-end"
        />
      </div>
      <ul className="space-y-0.5">
        {sorted?.map((s) => {
          const name = `${s.firstName} ${s.lastName}`.trim();
          const displayName = name || s.email;
          const barWidth = (s.eventsAttended / maxEvents) * 100;
          return (
            <li key={s.email}>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 rounded px-2 py-1.5 text-left transition-colors hover:bg-accent"
                  >
                    <div className="relative min-w-0">
                      <span
                        className="absolute inset-y-0 left-0 rounded bg-primary/10"
                        style={{ width: `${barWidth}%` }}
                        aria-hidden="true"
                      />
                      <span className="relative flex items-center gap-2">
                        <span className="truncate text-sm">{displayName}</span>
                        {s.isCommunityMember && (
                          <Badge
                            variant="secondary"
                            className="h-4 px-1 text-[10px]"
                          >
                            Community
                          </Badge>
                        )}
                      </span>
                    </div>
                    <span className="font-medium text-sm tabular-nums">
                      {s.eventsAttended}
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {formatShortDate(s.lastEventDate)}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="p-3">
                  <AttendeeHistoryPopover
                    email={s.email}
                    name={displayName}
                    isCommunityMember={s.isCommunityMember}
                  />
                </PopoverContent>
              </Popover>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SortButton({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn("h-6 justify-start px-1 font-medium text-xs", className)}
    >
      {label}
      <ArrowUpDown
        className={cn(
          "ml-1 size-3 transition-opacity",
          active ? "opacity-100" : "opacity-30",
          active && dir === "asc" && "rotate-180",
        )}
      />
    </Button>
  );
}

function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  } catch {
    return iso;
  }
}
