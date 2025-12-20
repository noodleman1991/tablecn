"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Check, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { type Attendee } from "@/db/schema";
import { checkInAttendee, undoCheckIn } from "@/app/actions";
import { EditableAttendeeCell } from "./editable-attendee-cell";
import { AttendeeActionsCell } from "./attendee-actions-cell";

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

interface CheckInTableHandlers {
  onDelete: (attendee: Attendee) => void;
}

export type { CheckInTableHandlers };

export function getCheckInTableColumns(
  handlers: CheckInTableHandlers
): ColumnDef<Attendee>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
          className="translate-y-[2px]"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
          className="translate-y-[2px]"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      id: "firstName",
      accessorKey: "firstName",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="First Name" />
      ),
      cell: ({ row }) => (
        <EditableAttendeeCell
          value={row.getValue("firstName")}
          attendeeId={row.original.id}
          field="firstName"
          placeholder="First name"
        />
      ),
      sortingFn: (rowA, rowB, columnId) => {
        const a = (rowA.getValue(columnId) as string | null) ?? "";
        const b = (rowB.getValue(columnId) as string | null) ?? "";
        return a.toLowerCase().localeCompare(b.toLowerCase());
      },
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
      cell: ({ row }) => (
        <EditableAttendeeCell
          value={row.getValue("lastName")}
          attendeeId={row.original.id}
          field="lastName"
          placeholder="Last name"
        />
      ),
      sortingFn: (rowA, rowB, columnId) => {
        const a = (rowA.getValue(columnId) as string | null) ?? "";
        const b = (rowB.getValue(columnId) as string | null) ?? "";
        return a.toLowerCase().localeCompare(b.toLowerCase());
      },
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
      cell: ({ row }) => (
        <EditableAttendeeCell
          value={row.getValue("email")}
          attendeeId={row.original.id}
          field="email"
          placeholder="email@example.com"
        />
      ),
      sortingFn: (rowA, rowB, columnId) => {
        const a = (rowA.getValue(columnId) as string | null) ?? "";
        const b = (rowB.getValue(columnId) as string | null) ?? "";
        return a.toLowerCase().localeCompare(b.toLowerCase());
      },
      meta: {
        label: "Email",
        placeholder: "Search email...",
        variant: "text",
      },
      enableColumnFilter: true,
    },
    {
      id: "source",
      header: "Source",
      cell: ({ row }) => {
        const attendee = row.original;

        if (attendee.manuallyAdded) {
          return <Badge variant="secondary">Manual</Badge>;
        }

        if (attendee.locallyModified) {
          return <Badge variant="outline">Edited</Badge>;
        }

        // Show WooCommerce badge for regular synced tickets
        return <Badge variant="default" className="bg-blue-100 text-blue-800 hover:bg-blue-100">WooCommerce</Badge>;
      },
      enableSorting: false,
      meta: {
        className: "hidden md:table-cell",
      } as any,
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
      id: "row-actions",
      cell: ({ row }) => (
        <AttendeeActionsCell
          attendee={row.original}
          onDelete={handlers.onDelete}
        />
      ),
      meta: {
        className: "w-[50px]",
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
