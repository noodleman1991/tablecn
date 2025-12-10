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
import { mergeMemberRecords } from "@/app/actions";
import { Badge } from "@/components/ui/badge";

interface MemberMergeDialogProps {
  members: Member[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMergeComplete: () => void;
}

export function MemberMergeDialog({
  members,
  open,
  onOpenChange,
  onMergeComplete,
}: MemberMergeDialogProps) {
  const [isMerging, setIsMerging] = React.useState(false);
  const [primaryMemberId, setPrimaryMemberId] = React.useState<string>("");

  // Reset primary selection when members change or dialog opens
  React.useEffect(() => {
    if (members.length > 0 && !primaryMemberId) {
      setPrimaryMemberId(members[0].id);
    }
  }, [members, primaryMemberId]);

  const handleMerge = async () => {
    if (members.length < 2) {
      toast.error("Please select at least 2 members to merge");
      return;
    }

    if (!primaryMemberId) {
      toast.error("Please select a primary member");
      return;
    }

    setIsMerging(true);
    try {
      const secondaryMembers = members.filter((m) => m.id !== primaryMemberId);

      // Merge each secondary member into the primary
      for (const secondaryMember of secondaryMembers) {
        await mergeMemberRecords({
          primaryMemberId,
          secondaryMemberId: secondaryMember.id,
        });
      }

      const primaryMember = members.find((m) => m.id === primaryMemberId);
      toast.success(
        `Successfully merged ${secondaryMembers.length} member${
          secondaryMembers.length > 1 ? "s" : ""
        } into ${primaryMember?.firstName} ${primaryMember?.lastName}`
      );
      onMergeComplete();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to merge members"
      );
    } finally {
      setIsMerging(false);
    }
  };

  if (members.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Merge Members</DialogTitle>
          <DialogDescription>
            Select which member's information to keep as the primary record. All
            event attendance from other members will be transferred to the
            primary member.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div>
            <p className="text-sm font-medium mb-2">
              Selected Members ({members.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {members.map((member) => (
                <Badge key={member.id} variant="secondary">
                  {member.firstName} {member.lastName}
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-3">
              Choose Primary Member (data to keep)
            </p>
            <RadioGroup
              value={primaryMemberId}
              onValueChange={setPrimaryMemberId}
            >
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-start space-x-3 rounded-lg border p-4"
                >
                  <RadioGroupItem
                    value={member.id}
                    id={member.id}
                    className="mt-1"
                  />
                  <Label htmlFor={member.id} className="flex-1 cursor-pointer">
                    <div className="font-medium">
                      {member.firstName} {member.lastName}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {member.email}
                    </div>
                    <div className="mt-1 flex gap-4 text-xs text-muted-foreground">
                      <span>Events: {member.totalEventsAttended}</span>
                      <span>
                        Status:{" "}
                        {member.isActiveMember ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="rounded-lg bg-muted p-4">
            <p className="text-sm font-medium mb-1">What will happen:</p>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>Primary member's name and email will be kept</li>
              <li>All event attendance records will be transferred</li>
              <li>Event counts and last event date will be recalculated</li>
              <li>Other members will be permanently deleted</li>
            </ul>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isMerging}
          >
            Cancel
          </Button>
          <Button onClick={handleMerge} disabled={isMerging}>
            {isMerging
              ? "Merging..."
              : `Merge ${members.length} Member${members.length > 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
