"use client";

import * as React from "react";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { useDataTable } from "@/hooks/use-data-table";
import type { Attendee } from "@/db/schema";
import { getCheckInTableColumns } from "./check-in-table-columns";

interface CheckInTableProps {
  attendees: Attendee[];
}

export function CheckInTable({ attendees }: CheckInTableProps) {
  const columns = React.useMemo(() => getCheckInTableColumns(), []);

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
    getRowId: (row) => row.id,
    manualPagination: false, // Use client-side pagination
  });

  return (
    <DataTable table={table} hideRowSelection>
      <DataTableToolbar table={table} />
    </DataTable>
  );
}
