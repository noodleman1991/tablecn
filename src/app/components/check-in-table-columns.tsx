"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Check, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type Attendee } from "@/db/schema";
import { checkInAttendee, undoCheckIn } from "@/app/actions";

// Memoized action cell for performance
const ActionCell = React.memo(
  ({
    attendee,
    onCheckIn,
    onUndoCheckIn,
  }: {
    attendee: Attendee;
    onCheckIn: (id: string) => void;
    onUndoCheckIn: (id: string) => void;
  }) => {
    const [isPending, startTransition] = React.useTransition();

    return !attendee.checkedIn ? (
      <Button
        size="sm"
        onClick={() => onCheckIn(attendee.id)}
        disabled={isPending}
        className="min-h-[44px] min-w-[44px]"
      >
        Check In
      </Button>
    ) : (
      <Button
        size="sm"
        variant="outline"
        onClick={() => onUndoCheckIn(attendee.id)}
        disabled={isPending}
        className="min-h-[44px] min-w-[44px]"
      >
        Undo
      </Button>
    );
  },
  (prevProps, nextProps) => {
    // Only re-render if this specific attendee changed
    return (
      prevProps.attendee.id === nextProps.attendee.id &&
      prevProps.attendee.checkedIn === nextProps.attendee.checkedIn
    );
  }
);

ActionCell.displayName = "ActionCell";

export function getCheckInTableColumns(): ColumnDef<Attendee>[] {
  return [
    {
      id: "firstName",
      accessorKey: "firstName",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="First Name" />
      ),
      cell: ({ row }) => row.getValue("firstName") || "-",
      meta: {
        label: "First Name",
        placeholder: "Search first name...",
        variant: "text",
      },
      enableColumnFilter: true,
    },
    {
      id: "lastName",
      accessorKey: "lastName",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Last Name" />
      ),
      cell: ({ row }) => row.getValue("lastName") || "-",
      meta: {
        label: "Last Name",
        placeholder: "Search last name...",
        variant: "text",
      },
      enableColumnFilter: true,
    },
    {
      id: "email",
      accessorKey: "email",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Email" />
      ),
      meta: {
        label: "Email",
        placeholder: "Search email...",
        variant: "text",
      },
      enableColumnFilter: true,
    },
    {
      id: "checkedIn",
      accessorKey: "checkedIn",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Status" />
      ),
      cell: ({ row }) => {
        const checkedIn = row.getValue("checkedIn") as boolean;
        return (
          <Badge variant={checkedIn ? "default" : "outline"}>
            {checkedIn ? (
              <>
                <Check className="mr-1 size-3" />
                Checked In
              </>
            ) : (
              <>
                <X className="mr-1 size-3" />
                Not Checked In
              </>
            )}
          </Badge>
        );
      },
      filterFn: (row, id, value) => {
        if (value === "all") return true;
        const checkedIn = row.getValue(id) as boolean;
        return value === "checked-in" ? checkedIn : !checkedIn;
      },
      meta: {
        label: "Status",
        variant: "select",
        options: [
          { label: "All", value: "all" },
          { label: "Checked In", value: "checked-in" },
          { label: "Not Checked In", value: "not-checked-in" },
        ],
      },
      enableColumnFilter: true,
    },
    {
      id: "woocommerceOrderId",
      accessorKey: "woocommerceOrderId",
      header: "Order ID",
      cell: ({ row }) => row.getValue("woocommerceOrderId") || "-",
      enableSorting: false,
      meta: {
        className: "hidden md:table-cell",
      } as any,
    },
    {
      id: "actions",
      header: "Actions",
      cell: function Cell({ row }) {
        const attendee = row.original;

        const handleCheckIn = (id: string) => {
          toast.promise(checkInAttendee(id), {
            loading: "Checking in...",
            success: "Checked in successfully",
            error: (err) => err.message || "Failed to check in",
          });
        };

        const handleUndoCheckIn = (id: string) => {
          toast.promise(undoCheckIn(id), {
            loading: "Undoing check-in...",
            success: "Check-in undone",
            error: (err) => err.message || "Failed to undo check-in",
          });
        };

        return (
          <ActionCell
            attendee={attendee}
            onCheckIn={handleCheckIn}
            onUndoCheckIn={handleUndoCheckIn}
          />
        );
      },
      enableSorting: false,
      enableHiding: false,
    },
  ];
}
