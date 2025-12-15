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
import type { Attendee } from "@/db/schema";
import { deleteAttendee } from "@/app/actions";

interface AttendeeDeleteDialogProps {
  attendee: Attendee | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AttendeeDeleteDialog({
  attendee,
  open,
  onOpenChange,
}: AttendeeDeleteDialogProps) {
  const [isDeleting, setIsDeleting] = React.useState(false);

  const handleDelete = async () => {
    if (!attendee) return;

    setIsDeleting(true);
    try {
      await deleteAttendee(attendee.id);
      toast.success(`${attendee.firstName} ${attendee.lastName} has been deleted`);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete attendee"
      );
    } finally {
      setIsDeleting(false);
    }
  };

  if (!attendee) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Attendee</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this attendee? This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <div className="rounded-lg border p-4">
            <div className="space-y-1">
              <p className="font-medium">
                {attendee.firstName} {attendee.lastName}
              </p>
              <p className="text-sm text-muted-foreground">{attendee.email}</p>
              {attendee.checkedIn && (
                <p className="text-sm text-green-600">✓ Checked In</p>
              )}
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
            {isDeleting ? "Deleting..." : "Delete Attendee"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
