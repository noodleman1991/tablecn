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
import type { Member } from "@/db/schema";

interface MemberActionsCellProps {
  member: Member;
  onStatusChange: (member: Member) => void;
  onSwapName: (member: Member) => void;
  onDelete: (member: Member) => void;
}

export const MemberActionsCell = React.memo(
  ({ member, onStatusChange, onSwapName, onDelete }: MemberActionsCellProps) => {
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
          <DropdownMenuItem
            onClick={() => startTransition(() => onStatusChange(member))}
          >
            Change Status
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => startTransition(() => onSwapName(member))}
          >
            Swap First/Last Name
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => startTransition(() => onDelete(member))}
            className="text-destructive focus:text-destructive"
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
  (prevProps, nextProps) => {
    return prevProps.member.id === nextProps.member.id;
  }
);

MemberActionsCell.displayName = "MemberActionsCell";
