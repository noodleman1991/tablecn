"use client";

import type { ColumnDef } from "@tanstack/react-table";
import * as React from "react";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { type Member } from "@/db/schema";
import { format } from "date-fns";
import { EditableCell } from "./editable-cell";
import { MemberActionsCell } from "./member-actions-cell";

interface MembersTableHandlers {
  onUpdateMember: (memberId: string, field: string, value: string) => Promise<void>;
  onStatusChange: (member: Member) => void;
  onDelete: (member: Member) => void;
}

export type { MembersTableHandlers };

export function getMembersTableColumns(
  handlers: MembersTableHandlers
): ColumnDef<Member>[] {
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
        <EditableCell
          value={row.getValue("firstName")}
          memberId={row.original.id}
          field="firstName"
          onSave={handlers.onUpdateMember}
          placeholder="First name"
        />
      ),
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
        <EditableCell
          value={row.getValue("lastName")}
          memberId={row.original.id}
          field="lastName"
          onSave={handlers.onUpdateMember}
          placeholder="Last name"
        />
      ),
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
        <EditableCell
          value={row.getValue("email")}
          memberId={row.original.id}
          field="email"
          onSave={handlers.onUpdateMember}
          placeholder="Email address"
          type="email"
        />
      ),
      meta: {
        label: "Email",
        placeholder: "Search email...",
        variant: "text",
      },
      enableColumnFilter: true,
    },
    {
      id: "isActiveMember",
      accessorKey: "isActiveMember",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Status" />
      ),
      cell: ({ row }) => {
        const isActive = row.getValue("isActiveMember") as boolean;
        return (
          <Badge variant={isActive ? "default" : "outline"}>
            {isActive ? "Active" : "Inactive"}
          </Badge>
        );
      },
      filterFn: (row, id, value) => {
        if (value === "all") return true;
        const isActive = row.getValue(id) as boolean;
        return value === "active" ? isActive : !isActive;
      },
      meta: {
        label: "Status",
        variant: "select",
        options: [
          { label: "All", value: "all" },
          { label: "Active", value: "active" },
          { label: "Inactive", value: "inactive" },
        ],
      },
      enableColumnFilter: true,
    },
    {
      id: "totalEventsAttended",
      accessorKey: "totalEventsAttended",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Events Attended" />
      ),
      cell: ({ row }) => row.getValue("totalEventsAttended"),
      meta: {
        className: "hidden md:table-cell",
      } as any,
    },
    {
      id: "lastEventDate",
      accessorKey: "lastEventDate",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Last Event" />
      ),
      cell: ({ row }) => {
        const date = row.getValue("lastEventDate") as Date | null;
        return date ? format(new Date(date), "PPP") : "-";
      },
      meta: {
        className: "hidden lg:table-cell",
      } as any,
    },
    {
      id: "membershipExpiresAt",
      accessorKey: "membershipExpiresAt",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Membership Expires" />
      ),
      cell: ({ row }) => {
        const date = row.getValue("membershipExpiresAt") as Date | null;
        return date ? format(new Date(date), "PPP") : "-";
      },
      meta: {
        className: "hidden lg:table-cell",
      } as any,
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <MemberActionsCell
          member={row.original}
          onStatusChange={handlers.onStatusChange}
          onDelete={handlers.onDelete}
        />
      ),
      meta: {
        className: "w-[50px]",
      } as any,
    },
  ];
}
