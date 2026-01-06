"use client";

import { useState } from "react";
import { confirmMemberMatch } from "@/app/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

interface MemberMatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attendeeId: string;
  possibleMatches: Array<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  }>;
}

export function MemberMatchDialog({
  open,
  onOpenChange,
  attendeeId,
  possibleMatches,
}: MemberMatchDialogProps) {
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const handleConfirm = async () => {
    if (!selectedMemberId) return;

    setIsConfirming(true);
    try {
      await confirmMemberMatch({ attendeeId, memberId: selectedMemberId });
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to confirm match:", error);
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Multiple Member Matches Found</DialogTitle>
          <DialogDescription>
            This attendee's details match multiple community members. Please
            select the correct member to count this attendance for.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={selectedMemberId || ""}
          onValueChange={setSelectedMemberId}
        >
          {possibleMatches.map((match) => (
            <div key={match.id} className="flex items-center space-x-2 py-2">
              <RadioGroupItem value={match.id} id={match.id} />
              <Label htmlFor={match.id} className="flex-1 cursor-pointer">
                <div className="font-medium">
                  {match.firstName} {match.lastName}
                </div>
                <div className="text-sm text-muted-foreground">
                  {match.email}
                </div>
              </Label>
            </div>
          ))}
        </RadioGroup>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selectedMemberId || isConfirming}
          >
            {isConfirming ? "Confirming..." : "Confirm Match"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
