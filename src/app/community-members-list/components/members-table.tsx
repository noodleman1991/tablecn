"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  bulkSwapNames,
  deleteMember,
  swapMemberName,
  updateMemberDetails,
} from "@/app/actions";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableScrollToggle } from "@/components/data-table/data-table-scroll-toggle";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Member } from "@/db/schema";
import { useDataTable } from "@/hooks/use-data-table";
import { MemberAliasesDialog } from "./member-aliases-dialog";
import { MemberDeleteDialog } from "./member-delete-dialog";
import { MemberMergeDialog } from "./member-merge-dialog";
import { MemberStatusDialog } from "./member-status-dialog";
import {
  getMembersTableColumns,
  type MembersTableHandlers,
} from "./members-table-columns";

interface MembersTableProps {
  members: Member[];
}

export function MembersTable({ members }: MembersTableProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = React.useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = React.useState(false);
  const [aliasesDialogOpen, setAliasesDialogOpen] = React.useState(false);
  const [selectedMember, setSelectedMember] = React.useState<Member | null>(
    null,
  );
  const [isDeletingBulk, setIsDeletingBulk] = React.useState(false);
  const [isSwappingBulk, setIsSwappingBulk] = React.useState(false);
  const [horizontalScrollEnabled, setHorizontalScrollEnabled] =
    React.useState(false);

  const handleSwapMemberName = React.useCallback(async (member: Member) => {
    try {
      await swapMemberName(member.id);
      toast.success(`Swapped name: ${member.lastName} ${member.firstName}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to swap name",
      );
    }
  }, []);

  const handlers = React.useMemo<MembersTableHandlers>(
    () => ({
      onUpdateMember: async (
        memberId: string,
        field: string,
        value: string,
      ) => {
        await updateMemberDetails({
          memberId,
          [field]: value,
        });
      },
      onStatusChange: (member: Member) => {
        setSelectedMember(member);
        setStatusDialogOpen(true);
      },
      onSwapName: handleSwapMemberName,
      onDelete: (member: Member) => {
        setSelectedMember(member);
        setDeleteDialogOpen(true);
      },
      onManageEmails: (member: Member) => {
        setSelectedMember(member);
        setAliasesDialogOpen(true);
      },
    }),
    [handleSwapMemberName],
  );

  const columns = React.useMemo(
    () => getMembersTableColumns(handlers),
    [handlers],
  );

  // Stable initialState reference: TanStack Table re-applies initialState when
  // the object identity changes. Without memoisation, every parent re-render
  // (e.g. after revalidatePath following an edit/merge) would recreate this
  // object and snap the page index back to 0.
  const initialState = React.useMemo(
    () => ({
      pagination: { pageIndex: 0, pageSize: 100 },
      sorting: [
        { id: "isActiveMember", desc: true } as const,
        { id: "lastName", desc: false } as const,
      ],
      columnVisibility: {
        postcode: false,
        city: false,
        country: false,
        phone: false,
        address: false,
      },
    }),
    [],
  );

  const { table } = useDataTable({
    data: members,
    columns,
    // pageCount removed - TanStack Table calculates automatically when manualPagination: false
    initialState,
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

  const handleBulkSwapNames = async () => {
    if (selectedMembers.length === 0) return;

    setIsSwappingBulk(true);
    try {
      const ids = selectedMembers.map((m) => m.id);
      const result = await bulkSwapNames(ids, "member");
      toast.success(`Swapped names for ${result.swapped} member(s)`);
      table.resetRowSelection();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to swap names",
      );
    } finally {
      setIsSwappingBulk(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedMembers.length === 0) {
      toast.error("Please select members to delete");
      return;
    }

    if (
      !confirm(
        `Are you sure you want to delete ${selectedMembers.length} member(s)?`,
      )
    ) {
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
        error instanceof Error ? error.message : "Failed to delete members",
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
        <div className="mb-4 flex flex-col items-start gap-2 rounded-lg border bg-muted/50 p-3 sm:flex-row sm:items-center">
          <Badge variant="secondary" className="font-normal text-xs sm:text-sm">
            <span className="sm:hidden">{selectedMembers.length} sel.</span>
            <span className="hidden sm:inline">
              {selectedMembers.length} selected
            </span>
          </Badge>
          <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row">
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
              variant="outline"
              size="sm"
              onClick={handleBulkSwapNames}
              disabled={isSwappingBulk || isDeletingBulk}
              className="min-h-[44px] w-full sm:w-auto"
            >
              {isSwappingBulk ? "Swapping..." : "Swap Names"}
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
        pageSizeOptions={[25, 50, 100, 9999]}
      >
        <DataTableToolbar table={table}>
          <DataTableScrollToggle
            enabled={horizontalScrollEnabled}
            onToggle={() =>
              setHorizontalScrollEnabled(!horizontalScrollEnabled)
            }
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
      <MemberAliasesDialog
        member={selectedMember}
        open={aliasesDialogOpen}
        onOpenChange={setAliasesDialogOpen}
      />
    </>
  );
}
