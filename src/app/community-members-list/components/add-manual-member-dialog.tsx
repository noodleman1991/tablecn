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
import { createManualMember } from "@/app/actions";

export function AddManualMemberDialog() {
  const [open, setOpen] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const [formData, setFormData] = React.useState({
    email: "",
    firstName: "",
    lastName: "",
    notes: "",
    manualExpiresAt: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Validate required fields
      if (!formData.email || !formData.firstName || !formData.lastName) {
        toast.error("Email, first name, and last name are required");
        return;
      }

      // Convert date string to Date object if provided
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

      // Reset form
      setFormData({
        email: "",
        firstName: "",
        lastName: "",
        notes: "",
        manualExpiresAt: "",
      });

      setOpen(false);
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

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
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
