"use client";

import * as React from "react";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { useDataTable } from "@/hooks/use-data-table";
import type { Attendee } from "@/db/schema";
import { getCheckInTableColumns, type CheckInTableHandlers } from "./check-in-table-columns";
import { deleteAttendee } from "@/app/actions";
import { AttendeeDeleteDialog } from "./attendee-delete-dialog";
import { AttendeeMergeDialog } from "./attendee-merge-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface CheckInTableProps {
  attendees: Attendee[];
}

export function CheckInTable({ attendees }: CheckInTableProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = React.useState(false);
  const [selectedAttendee, setSelectedAttendee] = React.useState<Attendee | null>(null);
  const [isDeletingBulk, setIsDeletingBulk] = React.useState(false);

  const handlers = React.useMemo<CheckInTableHandlers>(() => ({
    onDelete: (attendee: Attendee) => {
      setSelectedAttendee(attendee);
      setDeleteDialogOpen(true);
    },
  }), []);

  const columns = React.useMemo(() => getCheckInTableColumns(handlers), [handlers]);

  const { table } = useDataTable({
    data: attendees,
    columns,
    // pageCount removed - TanStack calculates automatically with client-side pagination
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
      sorting: [{ id: "lastName", desc: false }],
      columnVisibility: {},
    },
    enableAdvancedFilter: false,
    enableRowSelection: true,
    getRowId: (row) => row.id,
    manualPagination: false, // Use client-side pagination
    manualSorting: false, // Enable client-side sorting
    manualFiltering: false, // Enable client-side filtering
  });

  const selectedRows = table.getFilteredSelectedRowModel().rows;
  const selectedAttendees = selectedRows.map((row) => row.original);

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

    if (!confirm(`Are you sure you want to delete ${selectedAttendees.length} attendee(s)?`)) {
      return;
    }

    setIsDeletingBulk(true);
    try {
      for (const attendee of selectedAttendees) {
        await deleteAttendee(attendee.id);
      }
      toast.success(`Successfully deleted ${selectedAttendees.length} attendee(s)`);
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
      {selectedAttendees.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3 mb-4">
          <Badge variant="secondary" className="font-normal">
            {selectedAttendees.length} selected
          </Badge>
          <div className="flex gap-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBulkMerge}
              disabled={selectedAttendees.length < 2 || isDeletingBulk}
            >
              Merge Selected
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleBulkDelete}
              disabled={isDeletingBulk}
            >
              {isDeletingBulk ? "Deleting..." : "Delete Selected"}
            </Button>
          </div>
        </div>
      )}
      <DataTable table={table}>
        <DataTableToolbar table={table} />
      </DataTable>
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
