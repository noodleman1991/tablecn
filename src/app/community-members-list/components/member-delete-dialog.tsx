"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Member } from "@/db/schema";
import { deleteMember } from "@/app/actions";

interface MemberDeleteDialogProps {
  member: Member | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MemberDeleteDialog({
  member,
  open,
  onOpenChange,
}: MemberDeleteDialogProps) {
  const [isDeleting, setIsDeleting] = React.useState(false);

  const handleDelete = async () => {
    if (!member) return;

    setIsDeleting(true);
    try {
      await deleteMember(member.id);
      toast.success(`${member.firstName} ${member.lastName} has been deleted`);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete member"
      );
    } finally {
      setIsDeleting(false);
    }
  };

  if (!member) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Member</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this member? This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <div className="rounded-lg border p-4">
            <div className="space-y-1">
              <p className="font-medium">
                {member.firstName} {member.lastName}
              </p>
              <p className="text-sm text-muted-foreground">{member.email}</p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete Member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
