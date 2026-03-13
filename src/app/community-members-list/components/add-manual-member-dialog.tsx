"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { createManualMember, checkSwappedNameMatch } from "@/app/actions";

export function AddManualMemberDialog() {
  const [open, setOpen] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [swapWarning, setSwapWarning] = React.useState<Array<{ id: string; email: string; firstName: string; lastName: string }> | null>(null);

  const [formData, setFormData] = React.useState({
    email: "",
    firstName: "",
    lastName: "",
    notes: "",
    manualExpiresAt: "",
  });

  const doCreate = async () => {
    const manualExpiresAt = formData.manualExpiresAt
      ? new Date(formData.manualExpiresAt)
      : undefined;

    await createManualMember({
      email: formData.email,
      firstName: formData.firstName,
      lastName: formData.lastName,
      notes: formData.notes || undefined,
      manualExpiresAt,
    });

    toast.success("Member added successfully");

    setFormData({
      email: "",
      firstName: "",
      lastName: "",
      notes: "",
      manualExpiresAt: "",
    });
    setSwapWarning(null);
    setOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (!formData.email || !formData.firstName || !formData.lastName) {
        toast.error("Email, first name, and last name are required");
        return;
      }

      // Check for swapped name matches (unless already dismissed)
      if (!swapWarning) {
        const { matches } = await checkSwappedNameMatch(formData.firstName, formData.lastName);
        if (matches.length > 0) {
          setSwapWarning(matches);
          return;
        }
      }

      await doCreate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add member"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateAnyway = async () => {
    setIsSubmitting(true);
    try {
      await doCreate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add member"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default" size="sm" className="min-h-[44px]">
          <UserPlus className="mr-2 size-4" />
          Add Member
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[525px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Manual Member</DialogTitle>
            <DialogDescription>
              Create a new community member manually. Set a custom expiration
              date that will be preserved unless event attendance gives a later
              date.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="email">
                Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="member@example.com"
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="firstName">
                  First Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="firstName"
                  placeholder="John"
                  value={formData.firstName}
                  onChange={(e) =>
                    setFormData({ ...formData, firstName: e.target.value })
                  }
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="lastName">
                  Last Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="lastName"
                  placeholder="Doe"
                  value={formData.lastName}
                  onChange={(e) =>
                    setFormData({ ...formData, lastName: e.target.value })
                  }
                  required
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="manualExpiresAt">Custom Expiration Date</Label>
              <Input
                id="manualExpiresAt"
                type="date"
                value={formData.manualExpiresAt}
                onChange={(e) =>
                  setFormData({ ...formData, manualExpiresAt: e.target.value })
                }
              />
              <p className="text-sm text-muted-foreground">
                Optional. If member attends events, the later of this date or 9
                months from last event will be used.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">Notes / Reason for Adding</Label>
              <Textarea
                id="notes"
                placeholder="Special access, VIP member, etc..."
                value={formData.notes}
                onChange={(e) =>
                  setFormData({ ...formData, notes: e.target.value })
                }
                rows={3}
                maxLength={1000}
              />
              <p className="text-sm text-muted-foreground">
                {formData.notes.length} / 1000 characters
              </p>
            </div>
          </div>

          {swapWarning && swapWarning.length > 0 && (
            <div className="rounded-md border border-yellow-500 bg-yellow-50 p-3 text-sm">
              <p className="font-medium text-yellow-800 mb-2">
                Possible name swap detected
              </p>
              <p className="text-yellow-700 mb-2">
                Existing member(s) found with first/last name reversed:
              </p>
              <ul className="list-disc list-inside text-yellow-700 mb-3">
                {swapWarning.map((m) => (
                  <li key={m.id}>
                    {m.firstName} {m.lastName} ({m.email})
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCreateAnyway}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Adding..." : "Create Anyway"}
              </Button>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => { setOpen(false); setSwapWarning(null); }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Adding..." : "Add Member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
