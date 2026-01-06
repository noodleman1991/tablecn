"use client";

import * as React from "react";
import { flexRender } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { useDataTable } from "@/hooks/use-data-table";
import type { Attendee } from "@/db/schema";
import { getCheckInTableColumns, type CheckInTableHandlers, renderSubRow } from "./check-in-table-columns-grouped";
import { groupAttendeesByOrder, type GroupedOrder } from "@/lib/attendee-grouping";
import { deleteAttendee } from "@/app/actions";
import { AttendeeDeleteDialog } from "./attendee-delete-dialog";
import { AttendeeMergeDialog } from "./attendee-merge-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DataTableScrollToggle } from "@/components/data-table/data-table-scroll-toggle";

interface CheckInTableProps {
  attendees: Attendee[];
}

export function CheckInTable({ attendees }: CheckInTableProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = React.useState(false);
  const [selectedAttendee, setSelectedAttendee] = React.useState<Attendee | null>(null);
  const [isDeletingBulk, setIsDeletingBulk] = React.useState(false);
  const [horizontalScrollEnabled, setHorizontalScrollEnabled] = React.useState(false);

  // Expanded rows state
  const [expandedRows, setExpandedRows] = React.useState<Set<string>>(new Set());

  // Transform attendees into grouped data (by ORDER)
  const groupedOrders = React.useMemo(
    () => groupAttendeesByOrder(attendees),
    [attendees]
  );

  const toggleRow = React.useCallback((id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handlers = React.useMemo<CheckInTableHandlers>(() => ({
    onDelete: (attendee: Attendee) => {
      setSelectedAttendee(attendee);
      setDeleteDialogOpen(true);
    },
    expandedRows,
    toggleRow,
  }), [expandedRows, toggleRow]);

  const columns = React.useMemo(() => getCheckInTableColumns(handlers), [handlers]);

  const { table } = useDataTable({
    data: groupedOrders,
    columns,
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
      sorting: [{ id: "bookerLastName", desc: false }], // Sort by booker last name
      columnVisibility: {
        source: false,
      },
    },
    enableAdvancedFilter: false,
    enableRowSelection: true,
    getRowId: (row) => row.id,
    manualPagination: false,
    manualSorting: false,
    manualFiltering: false,
  });

  const selectedRows = table.getFilteredSelectedRowModel().rows;
  const selectedGroupedOrders = selectedRows.map((row) => row.original);

  // Flatten grouped orders back to individual attendees for bulk operations
  const selectedAttendees = selectedGroupedOrders.flatMap(g => g.tickets);

  const handleBulkMerge = () => {
    if (selectedAttendees.length < 2) {
      toast.error("Please select at least 2 attendees to merge");
      return;
    }
    setMergeDialogOpen(true);
  };

  const handleBulkDelete = async () => {
    if (selectedAttendees.length === 0) {
      toast.error("Please select attendees to delete");
      return;
    }

    const totalTickets = selectedAttendees.length;
    const message = totalTickets === selectedGroupedOrders.length
      ? `Are you sure you want to delete ${totalTickets} attendee(s)?`
      : `Are you sure you want to delete ${selectedGroupedOrders.length} order(s) with ${totalTickets} total ticket(s)?`;

    if (!confirm(message)) {
      return;
    }

    setIsDeletingBulk(true);
    try {
      for (const attendee of selectedAttendees) {
        await deleteAttendee(attendee.id);
      }
      toast.success(`Successfully deleted ${totalTickets} ticket(s)`);
      table.resetRowSelection();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete attendees"
      );
    } finally {
      setIsDeletingBulk(false);
    }
  };

  const handleMergeComplete = () => {
    table.resetRowSelection();
  };

  return (
    <>
      {selectedGroupedOrders.length > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 rounded-lg border bg-muted/50 p-3 mb-4">
          <Badge variant="secondary" className="font-normal text-xs sm:text-sm">
            <span className="sm:hidden">{selectedGroupedOrders.length} sel.</span>
            <span className="hidden sm:inline">
              {selectedGroupedOrders.length} selected ({selectedAttendees.length} total tickets)
            </span>
          </Badge>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto sm:ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBulkMerge}
              disabled={selectedAttendees.length < 2 || isDeletingBulk}
              className="min-h-[44px] w-full sm:w-auto"
            >
              Merge Selected
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleBulkDelete}
              disabled={isDeletingBulk}
              className="min-h-[44px] w-full sm:w-auto"
            >
              {isDeletingBulk ? "Deleting..." : "Delete Selected"}
            </Button>
          </div>
        </div>
      )}

      {/* Custom table with expandable rows */}
      <div className="flex w-full flex-col gap-2.5 overflow-auto">
        <DataTableToolbar table={table}>
          <DataTableScrollToggle
            enabled={horizontalScrollEnabled}
            onToggle={() => setHorizontalScrollEnabled(!horizontalScrollEnabled)}
          />
        </DataTableToolbar>
        <div className={cn(
          "overflow-hidden rounded-md border",
          horizontalScrollEnabled && "overflow-x-auto"
        )}>
          <table className="w-full caption-bottom text-sm">
            <thead className="[&_tr]:border-b">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b transition-colors hover:bg-muted/50">
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className={cn(
                        "h-12 px-4 text-left align-middle font-medium text-muted-foreground",
                        header.column.columnDef.meta?.className,
                      )}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="[&_tr:last-child]:border-0">
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <React.Fragment key={row.id}>
                    <tr
                      data-state={row.getIsSelected() && "selected"}
                      className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          className={cn(
                            "p-4 align-middle",
                            cell.column.columnDef.meta?.className,
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                    {/* Render sub-rows if expanded */}
                    {renderSubRow(row, handlers)}
                  </React.Fragment>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="h-24 text-center"
                  >
                    No results.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <DataTablePagination table={table} />
      </div>

      <AttendeeDeleteDialog
        attendee={selectedAttendee}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
      />
      <AttendeeMergeDialog
        attendees={selectedAttendees}
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        onMergeComplete={handleMergeComplete}
      />
    </>
  );
}
