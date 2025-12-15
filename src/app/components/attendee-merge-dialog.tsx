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
import type { Attendee } from "@/db/schema";
import { mergeAttendeeRecords } from "@/app/actions";
import { Badge } from "@/components/ui/badge";

interface AttendeeMergeDialogProps {
  attendees: Attendee[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMergeComplete: () => void;
}

export function AttendeeMergeDialog({
  attendees,
  open,
  onOpenChange,
  onMergeComplete,
}: AttendeeMergeDialogProps) {
  const [isMerging, setIsMerging] = React.useState(false);
  const [primaryAttendeeId, setPrimaryAttendeeId] = React.useState<string>("");

  // Reset primary selection when attendees change or dialog opens
  React.useEffect(() => {
    const firstAttendee = attendees[0];
    if (firstAttendee && !primaryAttendeeId) {
      setPrimaryAttendeeId(firstAttendee.id);
    }
  }, [attendees, primaryAttendeeId]);

  const handleMerge = async () => {
    if (attendees.length < 2) {
      toast.error("Please select at least 2 attendees to merge");
      return;
    }

    if (!primaryAttendeeId) {
      toast.error("Please select a primary attendee");
      return;
    }

    setIsMerging(true);
    try {
      const secondaryAttendees = attendees.filter((a) => a.id !== primaryAttendeeId);

      // Merge each secondary attendee into the primary
      for (const secondaryAttendee of secondaryAttendees) {
        await mergeAttendeeRecords({
          primaryAttendeeId,
          secondaryAttendeeId: secondaryAttendee.id,
        });
      }

      const primaryAttendee = attendees.find((a) => a.id === primaryAttendeeId);
      toast.success(
        `Successfully merged ${secondaryAttendees.length} attendee${
          secondaryAttendees.length > 1 ? "s" : ""
        } into ${primaryAttendee?.firstName} ${primaryAttendee?.lastName}`
      );
      onMergeComplete();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to merge attendees"
      );
    } finally {
      setIsMerging(false);
    }
  };

  if (attendees.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Merge Attendees</DialogTitle>
          <DialogDescription>
            Select which attendee's information to keep as the primary record.
            Check-in status will be preserved if any attendee is checked in.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div>
            <p className="text-sm font-medium mb-2">
              Selected Attendees ({attendees.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {attendees.map((attendee) => (
                <Badge key={attendee.id} variant="secondary">
                  {attendee.firstName} {attendee.lastName}
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-3">
              Choose Primary Attendee (data to keep)
            </p>
            <RadioGroup
              value={primaryAttendeeId}
              onValueChange={setPrimaryAttendeeId}
            >
              {attendees.map((attendee) => (
                <div
                  key={attendee.id}
                  className="flex items-start space-x-3 rounded-lg border p-4"
                >
                  <RadioGroupItem
                    value={attendee.id}
                    id={attendee.id}
                    className="mt-1"
                  />
                  <Label htmlFor={attendee.id} className="flex-1 cursor-pointer">
                    <div className="font-medium">
                      {attendee.firstName} {attendee.lastName}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {attendee.email}
                    </div>
                    <div className="mt-1 flex gap-4 text-xs text-muted-foreground">
                      <span>
                        Status:{" "}
                        {attendee.checkedIn ? (
                          <span className="text-green-600">✓ Checked In</span>
                        ) : (
                          "Not Checked In"
                        )}
                      </span>
                      {attendee.manuallyAdded && (
                        <Badge variant="secondary" className="text-xs">
                          Manual
                        </Badge>
                      )}
                      {attendee.locallyModified && (
                        <Badge variant="outline" className="text-xs">
                          Edited
                        </Badge>
                      )}
                    </div>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="rounded-lg bg-muted p-4">
            <p className="text-sm font-medium mb-1">What will happen:</p>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>Primary attendee's name and email will be kept</li>
              <li>Check-in status preserved if any attendee is checked in</li>
              <li>Other attendees will be permanently deleted</li>
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
              : `Merge ${attendees.length} Attendee${attendees.length > 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
