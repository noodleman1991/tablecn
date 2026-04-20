"use client";

import { Plus, Star, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import {
  addMemberAlias,
  getMemberAliases,
  type MemberAlias,
  setMemberPrimaryEmail,
  unlinkMemberAlias,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Member } from "@/db/schema";

interface MemberAliasesDialogProps {
  member: Member | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MemberAliasesDialog({
  member,
  open,
  onOpenChange,
}: MemberAliasesDialogProps) {
  const [aliases, setAliases] = React.useState<MemberAlias[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [newEmail, setNewEmail] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [busyEmail, setBusyEmail] = React.useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = React.useState<string | null>(null);
  const [confirmPrimary, setConfirmPrimary] = React.useState<string | null>(
    null,
  );

  const load = React.useCallback(async (memberId: string) => {
    setLoading(true);
    try {
      const list = await getMemberAliases(memberId);
      setAliases(list);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load aliases",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open && member) {
      load(member.id);
      setNewEmail("");
    }
  }, [open, member, load]);

  if (!member) return null;

  const handleAdd = async () => {
    if (!newEmail.trim()) return;
    setAdding(true);
    try {
      await addMemberAlias({
        memberId: member.id,
        email: newEmail.trim(),
      });
      toast.success(
        `Linked ${newEmail.trim()} to ${member.firstName ?? ""} ${member.lastName ?? ""}`.trim(),
      );
      setNewEmail("");
      await load(member.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add");
    } finally {
      setAdding(false);
    }
  };

  const handleUnlink = async (email: string) => {
    setBusyEmail(email);
    try {
      await unlinkMemberAlias(email);
      toast.success(`Removed ${email} from this member`);
      setConfirmUnlink(null);
      await load(member.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to unlink");
    } finally {
      setBusyEmail(null);
    }
  };

  const handleSetPrimary = async (email: string) => {
    setBusyEmail(email);
    try {
      await setMemberPrimaryEmail({
        memberId: member.id,
        newPrimaryEmail: email,
      });
      toast.success(`Primary email changed to ${email}`);
      setConfirmPrimary(null);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to set primary email",
      );
    } finally {
      setBusyEmail(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Alternative emails for {member.firstName} {member.lastName}
            </DialogTitle>
            <DialogDescription>
              Primary: <strong>{member.email}</strong>. Alternative emails below
              have had bookings attributed to this member, and future bookings
              from them will auto-attribute too.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <section className="flex flex-col gap-2">
              <h4 className="font-medium text-sm">Also known as</h4>
              {loading && (
                <p className="text-muted-foreground text-sm">Loading…</p>
              )}
              {!loading && aliases.length === 0 && (
                <p className="rounded-md border border-dashed p-3 text-center text-muted-foreground text-sm">
                  No alternative emails linked yet.
                </p>
              )}
              {!loading &&
                aliases.map((a) => (
                  <div
                    key={a.email}
                    className="flex items-center justify-between gap-2 rounded-md border p-2"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium text-sm">
                        {a.email}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        linked{" "}
                        {new Date(a.createdAt).toISOString().slice(0, 10)} ·{" "}
                        {a.source.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyEmail !== null}
                        onClick={() => setConfirmPrimary(a.email)}
                        title={`Make ${a.email} the primary email`}
                      >
                        <Star className="size-4" />
                        <span className="sr-only">
                          Set {a.email} as primary
                        </span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={busyEmail !== null}
                        onClick={() => setConfirmUnlink(a.email)}
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">Remove {a.email}</span>
                      </Button>
                    </div>
                  </div>
                ))}
            </section>

            <section className="flex flex-col gap-2">
              <h4 className="font-medium text-sm">Add alternative email</h4>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="other.email@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !adding && newEmail.trim()) {
                      e.preventDefault();
                      handleAdd();
                    }
                  }}
                  disabled={adding}
                />
                <Button
                  size="sm"
                  onClick={handleAdd}
                  disabled={adding || !newEmail.trim()}
                  className="gap-1"
                >
                  <Plus className="size-4" />
                  {adding ? "Linking…" : "Link"}
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Any past bookings from this email will be attributed to this
                member immediately. Future bookings auto-attribute.
              </p>
            </section>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmUnlink !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmUnlink(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove alternative email?</DialogTitle>
            <DialogDescription>
              <strong>{confirmUnlink}</strong> will be unlinked from this
              member. Past bookings stay attributed (they were already
              rewritten), but if a new booking arrives from this email it will
              reappear in Needs Review.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmUnlink(null)}
              disabled={busyEmail !== null}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busyEmail !== null}
              onClick={() =>
                confirmUnlink !== null && handleUnlink(confirmUnlink)
              }
            >
              {busyEmail !== null ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmPrimary !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmPrimary(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make this the primary email?</DialogTitle>
            <DialogDescription>
              <strong>{confirmPrimary}</strong> will become the primary email
              for{" "}
              <strong>
                {member.firstName} {member.lastName}
              </strong>
              . The current primary <strong>{member.email}</strong> becomes an
              alternative email. Future bookings from either address stay
              attributed to this member; past bookings get rewritten to the new
              primary. If the member is active, their Loops contact is moved
              to the new email.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmPrimary(null)}
              disabled={busyEmail !== null}
            >
              Cancel
            </Button>
            <Button
              disabled={busyEmail !== null}
              onClick={() =>
                confirmPrimary !== null && handleSetPrimary(confirmPrimary)
              }
            >
              {busyEmail !== null ? "Saving…" : "Set as primary"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
