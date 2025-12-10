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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { Member } from "@/db/schema";
import { toggleMemberStatusOverride } from "@/app/actions";

interface MemberStatusDialogProps {
  member: Member | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type StatusAction = "force-active" | "force-inactive" | "remove-override";

export function MemberStatusDialog({
  member,
  open,
  onOpenChange,
}: MemberStatusDialogProps) {
  const [isUpdating, setIsUpdating] = React.useState(false);
  const [statusAction, setStatusAction] = React.useState<StatusAction>(
    "force-active"
  );

  const handleUpdateStatus = async () => {
    if (!member) return;

    setIsUpdating(true);
    try {
      const data: Parameters<typeof toggleMemberStatusOverride>[0] = {
        memberId: member.id,
      };

      if (statusAction === "force-active") {
        data.forceActive = true;
      } else if (statusAction === "force-inactive") {
        data.forceInactive = true;
      }
      // For "remove-override", no additional flags needed

      await toggleMemberStatusOverride(data);

      const message =
        statusAction === "force-active"
          ? "Member set to active"
          : statusAction === "force-inactive"
          ? "Member set to inactive"
          : "Status override removed";

      toast.success(message);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update member status"
      );
    } finally {
      setIsUpdating(false);
    }
  };

  if (!member) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change Member Status</DialogTitle>
          <DialogDescription>
            Update the membership status for {member.firstName}{" "}
            {member.lastName}.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <RadioGroup
            value={statusAction}
            onValueChange={(value) => setStatusAction(value as StatusAction)}
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="force-active" id="force-active" />
              <Label htmlFor="force-active" className="font-normal">
                Force Active
                <span className="block text-sm text-muted-foreground">
                  Manually set member as active regardless of attendance
                </span>
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="force-inactive" id="force-inactive" />
              <Label htmlFor="force-inactive" className="font-normal">
                Force Inactive
                <span className="block text-sm text-muted-foreground">
                  Manually set member as inactive
                </span>
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="remove-override" id="remove-override" />
              <Label htmlFor="remove-override" className="font-normal">
                Remove Override
                <span className="block text-sm text-muted-foreground">
                  Recalculate status based on event attendance
                </span>
              </Label>
            </div>
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isUpdating}
          >
            Cancel
          </Button>
          <Button onClick={handleUpdateStatus} disabled={isUpdating}>
            {isUpdating ? "Updating..." : "Update Status"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
