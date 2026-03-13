"use client";

import * as React from "react";
import { MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Attendee } from "@/db/schema";

interface AttendeeActionsCellProps {
  attendee: Attendee;
  onSwapName?: (attendee: Attendee) => void;
  onDelete: (attendee: Attendee) => void;
}

export const AttendeeActionsCell = React.memo(
  ({ attendee, onSwapName, onDelete }: AttendeeActionsCellProps) => {
    const [isPending, startTransition] = React.useTransition();

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            className="h-8 w-8 p-0"
          >
            <span className="sr-only">Open menu</span>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onSwapName && (
            <>
              <DropdownMenuItem
                onClick={() => startTransition(() => onSwapName(attendee))}
              >
                Swap First/Last Name
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            onClick={() => startTransition(() => onDelete(attendee))}
            className="text-destructive focus:text-destructive"
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
  (prevProps, nextProps) => {
    return prevProps.attendee.id === nextProps.attendee.id;
  }
);

AttendeeActionsCell.displayName = "AttendeeActionsCell";
