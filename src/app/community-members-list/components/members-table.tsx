"use client";

import * as React from "react";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { useDataTable } from "@/hooks/use-data-table";
import type { Member } from "@/db/schema";
import { getMembersTableColumns, type MembersTableHandlers } from "./members-table-columns";
import { updateMemberDetails, deleteMember } from "@/app/actions";
import { MemberDeleteDialog } from "./member-delete-dialog";
import { MemberStatusDialog } from "./member-status-dialog";
import { MemberMergeDialog } from "./member-merge-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { DataTableScrollToggle } from "@/components/data-table/data-table-scroll-toggle";

interface MembersTableProps {
  members: Member[];
}

export function MembersTable({ members }: MembersTableProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = React.useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = React.useState(false);
  const [selectedMember, setSelectedMember] = React.useState<Member | null>(null);
  const [isDeletingBulk, setIsDeletingBulk] = React.useState(false);
  const [horizontalScrollEnabled, setHorizontalScrollEnabled] = React.useState(false);

  const handlers = React.useMemo<MembersTableHandlers>(() => ({
    onUpdateMember: async (memberId: string, field: string, value: string) => {
      await updateMemberDetails({
        memberId,
        [field]: value,
      });
    },
    onStatusChange: (member: Member) => {
      setSelectedMember(member);
      setStatusDialogOpen(true);
    },
    onDelete: (member: Member) => {
      setSelectedMember(member);
      setDeleteDialogOpen(true);
    },
  }), []);

  const columns = React.useMemo(() => getMembersTableColumns(handlers), [handlers]);

  const { table } = useDataTable({
    data: members,
    columns,
    // pageCount removed - TanStack Table calculates automatically when manualPagination: false
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
      sorting: [
        { id: "isActiveMember", desc: true },
        { id: "lastName", desc: false },
      ],
      columnVisibility: {},
    },
    enableAdvancedFilter: false,
    enableRowSelection: true,
    manualPagination: false, // Enable client-side pagination
    manualSorting: false, // Enable client-side sorting
    manualFiltering: false, // Enable client-side filtering
    getRowId: (row) => row.id,
  });

  const selectedRows = table.getFilteredSelectedRowModel().rows;
  const selectedMembers = selectedRows.map((row) => row.original);

  const handleBulkMerge = () => {
    if (selectedMembers.length < 2) {
      toast.error("Please select at least 2 members to merge");
      return;
    }
    setMergeDialogOpen(true);
  };

  const handleBulkDelete = async () => {
    if (selectedMembers.length === 0) {
      toast.error("Please select members to delete");
      return;
    }

    if (!confirm(`Are you sure you want to delete ${selectedMembers.length} member(s)?`)) {
      return;
    }

    setIsDeletingBulk(true);
    try {
      for (const member of selectedMembers) {
        await deleteMember(member.id);
      }
      toast.success(`Successfully deleted ${selectedMembers.length} member(s)`);
      table.resetRowSelection();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete members"
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
      {selectedMembers.length > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 rounded-lg border bg-muted/50 p-3 mb-4">
          <Badge variant="secondary" className="font-normal text-xs sm:text-sm">
            <span className="sm:hidden">{selectedMembers.length} sel.</span>
            <span className="hidden sm:inline">{selectedMembers.length} selected</span>
          </Badge>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto sm:ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBulkMerge}
              disabled={selectedMembers.length < 2 || isDeletingBulk}
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
      <DataTable
        table={table}
        horizontalScrollEnabled={horizontalScrollEnabled}
      >
        <DataTableToolbar table={table}>
          <DataTableScrollToggle
            enabled={horizontalScrollEnabled}
            onToggle={() => setHorizontalScrollEnabled(!horizontalScrollEnabled)}
          />
        </DataTableToolbar>
      </DataTable>
      <MemberDeleteDialog
        member={selectedMember}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
      />
      <MemberStatusDialog
        member={selectedMember}
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
      />
      <MemberMergeDialog
        members={selectedMembers}
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        onMergeComplete={handleMergeComplete}
      />
    </>
  );
}
