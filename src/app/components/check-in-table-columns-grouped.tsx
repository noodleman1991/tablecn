/**
 * Check-in Table Columns (Order-Based Grouping)
 *
 * This version works with GroupedOrder instead of Attendee.
 * - Groups tickets by woocommerceOrderId (ORDER-based)
 * - Main row shows booker information
 * - Expandable rows to show individual ticket holders
 * - Individual ticket check-ins and edits
 */

"use client";

import type { ColumnDef, Row } from "@tanstack/react-table";
import { Check, X, ChevronRight, ChevronDown, BookUser } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { Attendee } from "@/db/schema";
import { checkInAttendee, undoCheckIn, updateAttendeeDetails } from "@/app/actions";
import { AttendeeActionsCell } from "./attendee-actions-cell";
import type { GroupedOrder } from "@/lib/attendee-grouping";
import { getCheckInStatusDisplay, isActuallyGrouped } from "@/lib/attendee-grouping";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Check if an order is inactive (deleted, cancelled, or refunded)
 * Used for styling and disabling check-in buttons
 */
function isInactiveOrder(order: GroupedOrder): boolean {
  return order.tickets.every(t =>
    t.orderStatus === "deleted" ||
    t.orderStatus === "cancelled" ||
    t.orderStatus === "refunded"
  );
}

/**
 * Check if an individual ticket is inactive
 */
function isInactiveTicket(ticket: Attendee): boolean {
  return (
    ticket.orderStatus === "deleted" ||
    ticket.orderStatus === "cancelled" ||
    ticket.orderStatus === "refunded"
  );
}

/**
 * Count how many tickets in an order are inactive
 */
function getInactiveTicketCount(order: GroupedOrder): number {
  return order.tickets.filter(t =>
    t.orderStatus === "deleted" ||
    t.orderStatus === "cancelled" ||
    t.orderStatus === "refunded"
  ).length;
}

/**
 * Get the status badge label for an inactive order
 */
function getInactiveStatusLabel(order: GroupedOrder): string | null {
  const firstTicket = order.tickets[0];
  if (!firstTicket) return null;
  if (firstTicket.orderStatus === "deleted") return "Deleted";
  if (firstTicket.orderStatus === "cancelled") return "Cancelled";
  if (firstTicket.orderStatus === "refunded") return "Refunded";
  return null;
}

/**
 * Check if order has any members-only tickets
 */
function hasMembersOnlyTickets(order: GroupedOrder): boolean {
  return order.tickets.some(t => t.isMembersOnlyTicket);
}

/**
 * Editable cell for booker information (main row)
 * Booker info is NOT editable directly - only ticket holder info can be edited
 */
function BookerDisplayCell({
  order,
  field,
  value,
  placeholder,
}: {
  order: GroupedOrder;
  field: "bookerFirstName" | "bookerLastName" | "bookerEmail";
  value: string | null;
  placeholder: string;
}) {
  const inactive = isInactiveOrder(order);
  const inactiveLabel = getInactiveStatusLabel(order);
  const hasMembersOnly = hasMembersOnlyTickets(order);
  const inactiveCount = getInactiveTicketCount(order);
  const hasPartialDeletion = !inactive && inactiveCount > 0;

  // Booker info is read-only display with (Booker) badge
  return (
    <div className={cn("flex items-center gap-2", inactive && "line-through opacity-50")}>
      <span className="text-sm">
        {value || <span className="text-muted-foreground">{placeholder}</span>}
      </span>
      {/* Members-only indicator (purple icon) */}
      {hasMembersOnly && field === "bookerFirstName" && (
        <BookUser
          className="size-4 text-purple-600 flex-shrink-0"
          aria-label="Members-only ticket"
        />
      )}
      {/* Booker badge for multi-ticket orders */}
      {order.ticketCount > 1 && field === "bookerFirstName" && (
        <Badge variant="outline" className="text-xs">
          Booker
        </Badge>
      )}
      {/* Inactive status badge (Deleted/Cancelled/Refunded) - when ALL tickets are inactive */}
      {inactive && inactiveLabel && field === "bookerFirstName" && (
        <Badge
          variant={inactiveLabel === "Deleted" ? "destructive" : "secondary"}
          className="text-xs"
        >
          {inactiveLabel}
        </Badge>
      )}
      {/* Partial deletion badge - when SOME (not all) tickets are inactive */}
      {hasPartialDeletion && field === "bookerFirstName" && (
        <Badge variant="secondary" className="text-xs">
          {inactiveCount} of {order.ticketCount} deleted
        </Badge>
      )}
    </div>
  );
}

/**
 * DEPRECATED: Old editable cell for person-based grouping
 * Keeping for reference but not used in order-based grouping
 */
function EditableGroupedCell_OLD({
  grouped,
  field,
  value,
  placeholder,
}: {
  grouped: any;
  field: "firstName" | "lastName" | "email";
  value: string | null;
  placeholder: string;
}) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(value || "");
  const [showDialog, setShowDialog] = React.useState(false);
  const [pendingValue, setPendingValue] = React.useState("");

  const handleSave = async (updateAll: boolean) => {
    if (!pendingValue || pendingValue === value) {
      setShowDialog(false);
      setIsEditing(false);
      return;
    }

    try {
      if (updateAll) {
        // Update all tickets in the group
        for (const ticket of grouped.tickets) {
          await updateAttendeeDetails(ticket.id, field, pendingValue);
        }
        toast.success(`Updated ${field} for all ${grouped.ticketCount} tickets`);
      } else {
        // Update only the first ticket
        await updateAttendeeDetails(grouped.tickets[0]!.id, field, pendingValue);
        toast.success(`Updated ${field} for 1 ticket (marked as locally modified)`);
      }
    } catch (error) {
      toast.error("Failed to update");
    }

    setShowDialog(false);
    setIsEditing(false);
  };

  const handleBlur = () => {
    if (editValue === value) {
      setIsEditing(false);
      return;
    }

    if (isActuallyGrouped(grouped)) {
      // Show dialog for grouped attendees
      setPendingValue(editValue);
      setShowDialog(true);
    } else {
      // Single ticket: update directly
      updateAttendeeDetails(grouped.tickets[0]!.id, field, editValue)
        .then(() => toast.success(`Updated ${field}`))
        .catch(() => toast.error("Failed to update"));
      setIsEditing(false);
    }
  };

  return (
    <>
      {isEditing ? (
        <input
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleBlur();
            } else if (e.key === "Escape") {
              setEditValue(value || "");
              setIsEditing(false);
            }
          }}
          autoFocus
          className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
          placeholder={placeholder}
        />
      ) : (
        <div
          onClick={() => setIsEditing(true)}
          className="cursor-pointer rounded px-2 py-1 hover:bg-muted"
        >
          {value || <span className="text-muted-foreground">{placeholder}</span>}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update {grouped.ticketCount} Tickets?</DialogTitle>
            <DialogDescription>
              This person has {grouped.ticketCount} tickets. Would you like to update all
              tickets or just one?
              <br />
              <br />
              <strong>Note:</strong> Updating just one will mark that ticket as "locally
              modified" and it will appear as a separate row.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditValue(value || "");
                setIsEditing(false);
                setShowDialog(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => handleSave(false)}
            >
              Update One
            </Button>
            <Button onClick={() => handleSave(true)}>
              Update All {grouped.ticketCount}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface CheckInTableHandlers {
  onDelete: (attendee: Attendee) => void;
  expandedRows: Set<string>;
  toggleRow: (id: string) => void;
  onMutationSuccess?: (eventId: string) => void;
}

export type { CheckInTableHandlers };

/**
 * Editable field component for individual ticket fields
 * Uses optimistic updates for instant feedback
 */
function EditableTicketField({
  ticket,
  field,
  value,
  placeholder,
}: {
  ticket: Attendee;
  field: "firstName" | "lastName" | "email";
  value: string | null;
  placeholder: string;
}) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(value || "");
  const [isSaving, setIsSaving] = React.useState(false);
  const [optimisticValue, setOptimisticValue] = React.useState<string | null>(null);

  // Reset when value prop changes
  React.useEffect(() => {
    if (!isEditing && !isSaving) {
      setEditValue(value || "");
      setOptimisticValue(null);
    }
  }, [value, isEditing, isSaving]);

  const handleSave = async () => {
    const trimmedValue = editValue.trim();

    if (trimmedValue === (value || "")) {
      setIsEditing(false);
      return;
    }

    // OPTIMISTIC UPDATE: Close immediately and show new value
    setOptimisticValue(trimmedValue);
    setIsEditing(false);
    setIsSaving(true);

    try {
      await updateAttendeeDetails(ticket.id, field, trimmedValue);
      toast.success(`Updated ${field}`);
    } catch (error) {
      toast.error("Failed to update");
      // Rollback
      setOptimisticValue(null);
      setEditValue(value || "");
    } finally {
      setIsSaving(false);
    }
  };

  const displayValue = optimisticValue ?? value;

  return isEditing ? (
    <input
      type="text"
      value={editValue}
      onChange={(e) => setEditValue(e.target.value)}
      onBlur={handleSave}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          handleSave();
        } else if (e.key === "Escape") {
          setEditValue(value || "");
          setIsEditing(false);
        }
      }}
      autoFocus
      className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
      placeholder={placeholder}
    />
  ) : (
    <div
      onClick={() => !isSaving && setIsEditing(true)}
      className="cursor-pointer rounded px-2 py-1 hover:bg-muted/50 flex items-center gap-1"
    >
      {displayValue || <span className="text-muted-foreground">{placeholder}</span>}
      {isSaving && <span className="text-muted-foreground text-xs">(saving...)</span>}
    </div>
  );
}

/**
 * Sub-row component for individual tickets within a group
 */
function TicketSubRow({
  ticket,
  index,
  total,
  onDelete,
  onMutationSuccess,
}: {
  ticket: Attendee;
  index: number;
  total: number;
  onDelete: (attendee: Attendee) => void;
  onMutationSuccess?: (eventId: string) => void;
}) {
  const inactive = isInactiveTicket(ticket);

  const handleCheckIn = async () => {
    try {
      const result = await checkInAttendee(ticket.id);
      if (result.eventId && onMutationSuccess) {
        onMutationSuccess(result.eventId);
      }
      toast.success("Ticket checked in");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to check in");
    }
  };

  const handleUndoCheckIn = async () => {
    try {
      const result = await undoCheckIn(ticket.id);
      if (result.eventId && onMutationSuccess) {
        onMutationSuccess(result.eventId);
      }
      toast.success("Check-in undone");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to undo");
    }
  };

  // Check if ticket holder is different from booker
  const isDifferentPerson =
    ticket.bookerFirstName && ticket.bookerLastName &&
    (ticket.firstName !== ticket.bookerFirstName || ticket.lastName !== ticket.bookerLastName);

  // Get inactive status label for this ticket
  const getTicketInactiveLabel = () => {
    if (ticket.orderStatus === "deleted") return "Deleted";
    if (ticket.orderStatus === "cancelled") return "Cancelled";
    if (ticket.orderStatus === "refunded") return "Refunded";
    return null;
  };
  const inactiveLabel = getTicketInactiveLabel();

  return (
    <tr className={cn("border-b bg-muted/30", inactive && "opacity-50")}>
      <td className="p-2 pl-12" colSpan={5}>
        <div className={cn("flex items-center justify-between text-sm", inactive && "line-through")}>
          <div className="flex flex-col gap-1 flex-1">
            <div className="flex gap-2 items-center">
              <EditableTicketField
                ticket={ticket}
                field="firstName"
                value={ticket.firstName}
                placeholder="First name"
              />
              <EditableTicketField
                ticket={ticket}
                field="lastName"
                value={ticket.lastName}
                placeholder="Last name"
              />
              {/* Members-only indicator */}
              {ticket.isMembersOnlyTicket && (
                <BookUser
                  className="size-4 text-purple-600 flex-shrink-0"
                  aria-label="Members-only ticket"
                />
              )}
              {/* Inactive status badge */}
              {inactive && inactiveLabel && (
                <Badge
                  variant={inactiveLabel === "Deleted" ? "destructive" : "secondary"}
                  className="text-xs"
                >
                  {inactiveLabel}
                </Badge>
              )}
            </div>
            <EditableTicketField
              ticket={ticket}
              field="email"
              value={ticket.email}
              placeholder="email@example.com"
            />
            <div className="text-xs text-muted-foreground px-2">
              Ticket {index + 1} of {total} • Order #{ticket.woocommerceOrderId || "-"}
              {isDifferentPerson && (
                <span className="ml-2">
                  • Booked by: {ticket.bookerFirstName} {ticket.bookerLastName}
                </span>
              )}
            </div>
          </div>
          <Badge variant={ticket.checkedIn ? "default" : "outline"} className="text-xs">
            {ticket.checkedIn ? (
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
        </div>
      </td>
      <td className="p-2">
        {!ticket.checkedIn ? (
          <Button
            size="sm"
            onClick={handleCheckIn}
            disabled={inactive}
            className="min-h-[36px] min-w-[36px]"
          >
            Check In
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={handleUndoCheckIn}
            disabled={inactive}
            className="min-h-[36px] min-w-[36px]"
          >
            Undo
          </Button>
        )}
      </td>
      <td className="p-2">
        <AttendeeActionsCell attendee={ticket} onDelete={onDelete} />
      </td>
    </tr>
  );
}

export function getCheckInTableColumns(
  handlers: CheckInTableHandlers
): ColumnDef<GroupedOrder>[] {
  const { expandedRows, toggleRow } = handlers;

  return [
    {
      id: "expand",
      header: () => null,
      cell: ({ row }) => {
        const grouped = row.original;
        if (!isActuallyGrouped(grouped)) {
          return null;
        }

        const isExpanded = expandedRows.has(grouped.id);

        return (
          <button
            onClick={() => toggleRow(grouped.id)}
            className="flex size-8 items-center justify-center rounded hover:bg-muted"
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </button>
        );
      },
      enableSorting: false,
      enableHiding: false,
      meta: {
        className: "w-[40px]",
      } as any,
    },
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
      meta: {
        className: "w-[36px] px-1",
      } as any,
    },
    {
      id: "bookerFirstName",
      accessorKey: "bookerFirstName",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="First Name" />
      ),
      cell: ({ row }) => (
        <BookerDisplayCell
          order={row.original}
          field="bookerFirstName"
          value={row.getValue("bookerFirstName")}
          placeholder="First name"
        />
      ),
      sortingFn: (rowA, rowB, columnId) => {
        const a = (rowA.getValue(columnId) as string | null) ?? "";
        const b = (rowB.getValue(columnId) as string | null) ?? "";
        return a.toLowerCase().localeCompare(b.toLowerCase());
      },
      // Deep search: search both booker AND all ticket holders
      filterFn: (row, columnId, filterValue) => {
        if (!filterValue || typeof filterValue !== "string") return true;
        const order = row.original;
        const searchTerm = filterValue.toLowerCase();

        // Search booker first name
        if (order.bookerFirstName?.toLowerCase().includes(searchTerm)) return true;

        // Search ALL tickets' first names in the order
        for (const ticket of order.tickets) {
          if (ticket.firstName?.toLowerCase().includes(searchTerm)) return true;
        }

        return false;
      },
      meta: {
        label: "First Name",
        placeholder: "Search first name...",
        variant: "text",
        className: "max-w-[120px]",
      },
      enableColumnFilter: true,
    },
    {
      id: "bookerLastName",
      accessorKey: "bookerLastName",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Last Name" />
      ),
      cell: ({ row }) => (
        <BookerDisplayCell
          order={row.original}
          field="bookerLastName"
          value={row.getValue("bookerLastName")}
          placeholder="Last name"
        />
      ),
      sortingFn: (rowA, rowB, columnId) => {
        const a = (rowA.getValue(columnId) as string | null) ?? "";
        const b = (rowB.getValue(columnId) as string | null) ?? "";
        return a.toLowerCase().localeCompare(b.toLowerCase());
      },
      // Deep search: search both booker AND all ticket holders
      filterFn: (row, columnId, filterValue) => {
        if (!filterValue || typeof filterValue !== "string") return true;
        const order = row.original;
        const searchTerm = filterValue.toLowerCase();

        // Search booker last name
        if (order.bookerLastName?.toLowerCase().includes(searchTerm)) return true;

        // Search ALL tickets' last names in the order
        for (const ticket of order.tickets) {
          if (ticket.lastName?.toLowerCase().includes(searchTerm)) return true;
        }

        return false;
      },
      meta: {
        label: "Last Name",
        placeholder: "Search last name...",
        variant: "text",
        className: "hidden lg:table-cell",
      },
      enableColumnFilter: true,
    },
    {
      id: "bookerEmail",
      accessorKey: "bookerEmail",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Email" />
      ),
      cell: ({ row }) => (
        <BookerDisplayCell
          order={row.original}
          field="bookerEmail"
          value={row.getValue("bookerEmail")}
          placeholder="email@example.com"
        />
      ),
      sortingFn: (rowA, rowB, columnId) => {
        const a = (rowA.getValue(columnId) as string | null) ?? "";
        const b = (rowB.getValue(columnId) as string | null) ?? "";
        return a.toLowerCase().localeCompare(b.toLowerCase());
      },
      // Deep search: search both booker AND all ticket holders
      filterFn: (row, columnId, filterValue) => {
        if (!filterValue || typeof filterValue !== "string") return true;
        const order = row.original;
        const searchTerm = filterValue.toLowerCase();

        // Search booker email
        if (order.bookerEmail?.toLowerCase().includes(searchTerm)) return true;

        // Search ALL tickets' emails in the order
        for (const ticket of order.tickets) {
          if (ticket.email?.toLowerCase().includes(searchTerm)) return true;
        }

        return false;
      },
      meta: {
        label: "Email",
        placeholder: "Search email...",
        variant: "text",
        className: "hidden xl:table-cell",
      },
      enableColumnFilter: true,
    },
    {
      id: "ticketCount",
      accessorKey: "ticketCount",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Tickets" />
      ),
      cell: ({ row }) => {
        const count = row.getValue("ticketCount") as number;
        return (
          <div className="font-medium text-center">
            {count}
          </div>
        );
      },
      enableSorting: true,
      enableHiding: true,
      meta: {
        label: "Tickets",
        className: "w-[70px] hidden md:table-cell",
      } as any,
    },
    {
      id: "source",
      accessorFn: (row) => {
        if (row.isManuallyAdded) return "manual";
        if (row.isLocallyModified) return "edited";
        return "woocommerce";
      },
      header: "Source",
      cell: ({ row }) => {
        const grouped = row.original;

        if (grouped.isManuallyAdded) {
          return <Badge variant="secondary">Manual</Badge>;
        }

        if (grouped.isLocallyModified) {
          return <Badge variant="outline">Edited</Badge>;
        }

        // Show WooCommerce badge for regular synced tickets
        return <Badge variant="default" className="bg-blue-100 text-blue-800 hover:bg-blue-100">WooCommerce</Badge>;
      },
      enableSorting: false,
      enableHiding: true,
      meta: {
        label: "Source",
        className: "hidden lg:table-cell",
      } as any,
    },
    {
      id: "checkedInStatus",
      accessorKey: "checkedInStatus",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Status" />
      ),
      cell: ({ row }) => {
        const grouped = row.original;
        const status = getCheckInStatusDisplay(grouped);
        const isCheckedIn = grouped.checkedInStatus === "all";
        const isPartial = grouped.checkedInStatus === "partial";

        return (
          <Badge variant={isCheckedIn ? "default" : isPartial ? "secondary" : "outline"}>
            {isCheckedIn ? (
              <>
                <Check className="mr-1 size-3" />
                {status}
              </>
            ) : isPartial ? (
              <>
                <Check className="mr-1 size-3" />
                {status}
              </>
            ) : (
              <>
                <X className="mr-1 size-3" />
                {status}
              </>
            )}
          </Badge>
        );
      },
      filterFn: (row, id, value) => {
        if (value === "all") return true;
        const status = (row.getValue(id) as string);
        if (value === "checked-in") return status === "all";
        if (value === "partial") return status === "partial";
        return status === "none";
      },
      meta: {
        label: "Status",
        variant: "select",
        options: [
          { label: "All", value: "all" },
          { label: "Checked In", value: "checked-in" },
          { label: "Partial", value: "partial" },
          { label: "Not Checked In", value: "not-checked-in" },
        ],
      },
      enableColumnFilter: true,
    },
    {
      id: "woocommerceOrderId",
      accessorKey: "woocommerceOrderId",
      header: "Order ID",
      cell: ({ row }) => {
        const orderId = row.getValue("woocommerceOrderId") as string | null;
        return orderId || "-";
      },
      enableSorting: true,
      enableHiding: true,
      meta: {
        label: "Order ID",
        className: "hidden xl:table-cell",
      } as any,
    },
    {
      id: "row-actions",
      cell: ({ row }) => {
        const grouped = row.original;
        // For grouped attendees, use the first ticket for the actions menu
        return (
          <AttendeeActionsCell
            attendee={grouped.tickets[0]!}
            onDelete={handlers.onDelete}
          />
        );
      },
      meta: {
        className: "hidden 2xl:table-cell w-[50px]",
      } as any,
    },
    {
      id: "actions",
      header: "Actions",
      cell: function Cell({ row }) {
        const grouped = row.original;
        const inactive = isInactiveOrder(grouped);

        const handleCheckInAll = async () => {
          const uncheckedTickets = grouped.tickets.filter(t => !t.checkedIn && !isInactiveTicket(t));

          if (uncheckedTickets.length === 0) {
            toast.info("All tickets already checked in");
            return;
          }

          try {
            const results = await Promise.all(uncheckedTickets.map(t => checkInAttendee(t.id)));
            // Trigger cache invalidation with first result's eventId
            if (results[0]?.eventId && handlers.onMutationSuccess) {
              handlers.onMutationSuccess(results[0].eventId);
            }
            toast.success(`Checked in ${uncheckedTickets.length} ticket(s)`);
          } catch {
            toast.error("Failed to check in some tickets");
          }
        };

        const handleUndoAll = async () => {
          const checkedTickets = grouped.tickets.filter(t => t.checkedIn && !isInactiveTicket(t));

          if (checkedTickets.length === 0) {
            toast.info("No tickets to undo");
            return;
          }

          try {
            const results = await Promise.all(checkedTickets.map(t => undoCheckIn(t.id)));
            // Trigger cache invalidation with first result's eventId
            if (results[0]?.eventId && handlers.onMutationSuccess) {
              handlers.onMutationSuccess(results[0].eventId);
            }
            toast.success(`Undone ${checkedTickets.length} ticket(s)`);
          } catch {
            toast.error("Failed to undo some tickets");
          }
        };

        // If all checked in, show Undo All button
        // If none or some checked in, show Check In button
        return grouped.allCheckedIn ? (
          <Button
            size="sm"
            variant="outline"
            onClick={handleUndoAll}
            disabled={inactive}
            className="min-h-[44px] px-2 md:px-4"
          >
            <span className="hidden md:inline">Undo All</span>
            <span className="md:hidden">Undo</span>
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleCheckInAll}
            disabled={inactive}
            className="min-h-[44px] px-2 md:px-4"
          >
            <span className="hidden md:inline">
              Check In {grouped.checkedInStatus === "none" ? "All" : "Remaining"}
            </span>
            <span className="md:hidden">Check</span>
          </Button>
        );
      },
      enableSorting: false,
      enableHiding: false,
    },
  ];
}

/**
 * Render function for expanded rows (shows individual ticket holders)
 */
export function renderSubRow(
  row: Row<GroupedOrder>,
  handlers: CheckInTableHandlers
) {
  const order = row.original;

  if (!isActuallyGrouped(order) || !handlers.expandedRows.has(order.id)) {
    return null;
  }

  return order.tickets.map((ticket, index) => (
    <TicketSubRow
      key={ticket.id}
      ticket={ticket}
      index={index}
      total={order.ticketCount}
      onDelete={handlers.onDelete}
      onMutationSuccess={handlers.onMutationSuccess}
    />
  ));
}
