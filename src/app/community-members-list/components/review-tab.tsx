"use client";

import {
  AlertTriangle,
  CheckCircle2,
  EyeOff,
  Search,
  UserPlus,
  Users,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import type { OrphanBooker } from "@/app/actions";
import {
  createMemberFromOrphan,
  ignoreOrphanEmail,
  mergeOrphanIntoMember,
} from "@/app/actions";
import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Member } from "@/db/schema";
import { MemberPicker } from "./member-picker";

interface ReviewTabProps {
  orphans: OrphanBooker[];
  members: Pick<Member, "id" | "email" | "firstName" | "lastName">[];
}

type FilterKey = "all" | "nameMatch" | "localMatch" | "noHints";

interface Candidate {
  memberId: string;
  email: string;
  source: "name" | "localPart";
  ambiguous: boolean;
}

function getCandidates(orphan: OrphanBooker): Candidate[] {
  const candidates: Candidate[] = [];
  if (orphan.nameMatchMemberId && orphan.nameMatchEmail) {
    candidates.push({
      memberId: orphan.nameMatchMemberId,
      email: orphan.nameMatchEmail,
      source: "name",
      ambiguous: orphan.nameMatchCandidateCount > 1,
    });
  }
  if (
    orphan.localPartMatchMemberId &&
    orphan.localPartMatchEmail &&
    orphan.localPartMatchMemberId !== orphan.nameMatchMemberId
  ) {
    candidates.push({
      memberId: orphan.localPartMatchMemberId,
      email: orphan.localPartMatchEmail,
      source: "localPart",
      ambiguous: false,
    });
  }
  return candidates;
}

export function ReviewTab({ orphans, members }: ReviewTabProps) {
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<FilterKey>("all");
  const [busy, setBusy] = React.useState<string | null>(null);

  // Per-orphan selected candidate (memberId). Seeded from hints on first render.
  const [selectedTarget, setSelectedTarget] = React.useState<
    Record<string, string | null>
  >({});

  // Confirmation dialog state
  const [confirm, setConfirm] = React.useState<{
    action: "merge" | "create" | "ignore";
    orphan: OrphanBooker;
    targetMemberId?: string;
    targetLabel?: string;
  } | null>(null);

  // "Search all members" fallback picker state
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickerOrphan, setPickerOrphan] = React.useState<OrphanBooker | null>(
    null,
  );
  const [pickerTargetId, setPickerTargetId] = React.useState<string | null>(
    null,
  );

  const memberById = React.useMemo(() => {
    const map = new Map<string, (typeof members)[number]>();
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members]);

  const counts = React.useMemo(() => {
    let nameMatch = 0;
    let localMatch = 0;
    let noHints = 0;
    for (const o of orphans) {
      const hasName = !!o.nameMatchMemberId;
      const hasLocal = !!o.localPartMatchMemberId;
      if (hasName) nameMatch++;
      if (hasLocal && !hasName) localMatch++;
      if (!hasName && !hasLocal) noHints++;
    }
    return { all: orphans.length, nameMatch, localMatch, noHints };
  }, [orphans]);

  const filtered = React.useMemo(() => {
    const s = search.trim().toLowerCase();
    return orphans.filter((o) => {
      const hasName = !!o.nameMatchMemberId;
      const hasLocal = !!o.localPartMatchMemberId;
      if (filter === "nameMatch" && !hasName) return false;
      if (filter === "localMatch" && (hasName || !hasLocal)) return false;
      if (filter === "noHints" && (hasName || hasLocal)) return false;
      if (!s) return true;
      return (
        o.email.toLowerCase().includes(s) ||
        (o.firstName ?? "").toLowerCase().includes(s) ||
        (o.lastName ?? "").toLowerCase().includes(s)
      );
    });
  }, [orphans, search, filter]);

  const pickTarget = (orphanEmail: string, candidates: Candidate[]) => {
    const explicit = selectedTarget[orphanEmail];
    if (explicit !== undefined) return explicit;
    return candidates[0]?.memberId ?? null;
  };

  const runMerge = async (
    orphan: OrphanBooker,
    targetMemberId: string,
    targetLabel: string,
  ) => {
    setBusy(orphan.email);
    try {
      await mergeOrphanIntoMember({
        orphanEmail: orphan.email,
        targetMemberId,
      });
      toast.success(`Merged ${orphan.email} into ${targetLabel}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to merge");
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const runCreate = async (orphan: OrphanBooker) => {
    setBusy(orphan.email);
    try {
      await createMemberFromOrphan(orphan.email);
      toast.success(`Created new member ${orphan.email}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create");
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const runIgnore = async (orphan: OrphanBooker) => {
    setBusy(orphan.email);
    try {
      await ignoreOrphanEmail(orphan.email);
      toast.success(`${orphan.email} marked as ignored`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to ignore");
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const openPicker = (orphan: OrphanBooker) => {
    setPickerOrphan(orphan);
    setPickerTargetId(null);
    setPickerOpen(true);
  };

  const confirmPickerMerge = () => {
    if (!pickerOrphan || !pickerTargetId) return;
    const target = memberById.get(pickerTargetId);
    if (!target) return;
    setPickerOpen(false);
    setConfirm({
      action: "merge",
      orphan: pickerOrphan,
      targetMemberId: pickerTargetId,
      targetLabel:
        `${target.firstName ?? ""} ${target.lastName ?? ""} <${target.email}>`.trim(),
    });
  };

  if (orphans.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <CheckCircle2 className="size-12 text-muted-foreground" />
        <h3 className="font-medium text-lg">All caught up</h3>
        <p className="text-muted-foreground text-sm">
          No orphan booking emails to review.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">
          These bookings don&apos;t match any existing member. Merge duplicates
          into an existing member, promote genuinely new people, or mark
          typos/tests as ignored.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <FilterChip
            active={filter === "all"}
            onClick={() => setFilter("all")}
            label={`All (${counts.all})`}
          />
          <FilterChip
            active={filter === "nameMatch"}
            onClick={() => setFilter("nameMatch")}
            label={`Has name match (${counts.nameMatch})`}
          />
          <FilterChip
            active={filter === "localMatch"}
            onClick={() => setFilter("localMatch")}
            label={`Local-part match only (${counts.localMatch})`}
          />
          <FilterChip
            active={filter === "noHints"}
            onClick={() => setFilter("noHints")}
            label={`No hints (${counts.noHints})`}
          />
        </div>
        <Input
          type="search"
          placeholder="Search email or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-xs"
        />
      </div>

      <div className="flex flex-col gap-3">
        {filtered.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
            No orphans match the current filter.
          </div>
        )}
        {filtered.map((orphan) => {
          const candidates = getCandidates(orphan);
          const selected = pickTarget(orphan.email, candidates);
          const isBusy = busy === orphan.email;

          return (
            <article
              key={orphan.email}
              className="flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-sm"
            >
              <header className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{orphan.email}</span>
                    {orphan.firstName || orphan.lastName ? (
                      <span className="text-muted-foreground text-sm">
                        {orphan.firstName ?? ""} {orphan.lastName ?? ""}
                      </span>
                    ) : null}
                  </div>
                  {orphan.bookerEmail &&
                    orphan.bookerEmail !== orphan.email && (
                      <p className="text-muted-foreground text-xs">
                        booked by {orphan.bookerEmail}
                      </p>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs sm:whitespace-nowrap">
                  <Badge variant="secondary">
                    {orphan.bookingCount}{" "}
                    {orphan.bookingCount === 1 ? "booking" : "bookings"}
                  </Badge>
                  {orphan.latestBooking && (
                    <span>
                      latest {orphan.latestBooking.toISOString().slice(0, 10)}
                    </span>
                  )}
                </div>
              </header>

              {candidates.length > 0 && (
                <section className="flex flex-col gap-2">
                  <p className="font-medium text-sm">
                    Looks like this could be:
                  </p>
                  <RadioGroup
                    value={selected ?? ""}
                    onValueChange={(v) =>
                      setSelectedTarget((prev) => ({
                        ...prev,
                        [orphan.email]: v,
                      }))
                    }
                    className="flex flex-col gap-1"
                  >
                    {candidates.map((c) => {
                      const member = memberById.get(c.memberId);
                      const label = member
                        ? `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() ||
                          member.email
                        : c.email;
                      const id = `${orphan.email}-${c.memberId}`;
                      return (
                        <div
                          key={id}
                          className="flex items-start gap-2 rounded-md border p-2"
                        >
                          <RadioGroupItem
                            value={c.memberId}
                            id={id}
                            className="mt-0.5"
                          />
                          <Label
                            htmlFor={id}
                            className="flex min-w-0 flex-1 flex-col gap-1 font-normal"
                          >
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="truncate font-medium">
                                {label}
                              </span>
                              <span className="truncate text-muted-foreground text-xs">
                                {c.email}
                              </span>
                            </span>
                            <span className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                              <Badge variant="outline" className="font-normal">
                                {c.source === "name"
                                  ? "name match"
                                  : "same email prefix"}
                              </Badge>
                              {c.ambiguous && (
                                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
                                  <AlertTriangle className="size-3" />
                                  {orphan.nameMatchCandidateCount} people share
                                  this name — pick carefully
                                </span>
                              )}
                            </span>
                          </Label>
                        </div>
                      );
                    })}
                  </RadioGroup>
                </section>
              )}

              <footer className="flex flex-wrap items-center gap-2">
                {candidates.length > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        disabled={isBusy || !selected}
                        onClick={() => {
                          const target = selected
                            ? memberById.get(selected)
                            : undefined;
                          if (!target || !selected) return;
                          setConfirm({
                            action: "merge",
                            orphan,
                            targetMemberId: selected,
                            targetLabel:
                              `${target.firstName ?? ""} ${target.lastName ?? ""} <${target.email}>`.trim(),
                          });
                        }}
                        className="gap-1"
                      >
                        <Users className="size-3.5" />
                        Merge into selected
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Attributes all this email&apos;s bookings to the selected
                      member. Future bookings from this email will
                      auto-attribute.
                    </TooltipContent>
                  </Tooltip>
                )}

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isBusy}
                      onClick={() => setConfirm({ action: "create", orphan })}
                      className="gap-1"
                    >
                      <UserPlus className="size-3.5" />
                      Create new member
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Promotes this email into a brand-new member record. Use when
                    this is a genuinely new person.
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isBusy}
                      onClick={() => openPicker(orphan)}
                      className="gap-1"
                    >
                      <Search className="size-3.5" />
                      Search all members
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Merge into any member by searching the full list.
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isBusy}
                      onClick={() => setConfirm({ action: "ignore", orphan })}
                      className="gap-1 text-muted-foreground"
                    >
                      <EyeOff className="size-3.5" />
                      Ignore
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Records this email as &quot;not a real member&quot;.
                    Won&apos;t re-surface in review and won&apos;t auto-create
                    on next booking. Use for typos, tests, or duplicates.
                  </TooltipContent>
                </Tooltip>
              </footer>
            </article>
          );
        })}
      </div>

      <Dialog
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);
          if (!open) {
            setPickerOrphan(null);
            setPickerTargetId(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Search all members</DialogTitle>
            <DialogDescription>
              {pickerOrphan && (
                <>
                  Pick the member that {pickerOrphan.email} (
                  {pickerOrphan.firstName} {pickerOrphan.lastName}) should merge
                  into.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <MemberPicker
              members={members}
              selectedMemberId={pickerTargetId}
              onSelect={setPickerTargetId}
              placeholder="Search by name or email…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmPickerMerge} disabled={!pickerTargetId}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.action === "merge" && "Merge into existing member?"}
              {confirm?.action === "create" && "Create new member?"}
              {confirm?.action === "ignore" && "Ignore this email?"}
            </DialogTitle>
            <DialogDescription>
              {confirm?.action === "merge" && confirm.targetLabel && (
                <>
                  All bookings from <strong>{confirm.orphan.email}</strong> will
                  be attributed to <strong>{confirm.targetLabel}</strong>.
                  Future bookings from this email will auto-attribute to the
                  same member.
                </>
              )}
              {confirm?.action === "create" && (
                <>
                  A new member record will be created with{" "}
                  <strong>{confirm.orphan.email}</strong> as the primary email.
                  Past bookings from this address will count toward the new
                  member.
                </>
              )}
              {confirm?.action === "ignore" && (
                <>
                  <strong>{confirm.orphan.email}</strong> will be recorded as
                  &quot;not a real member&quot;. It won&apos;t appear in review
                  again and future bookings from it won&apos;t create a member
                  automatically.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirm(null)}
              disabled={busy !== null}
            >
              Cancel
            </Button>
            <Button
              disabled={busy !== null}
              onClick={() => {
                if (!confirm) return;
                if (confirm.action === "merge" && confirm.targetMemberId) {
                  runMerge(
                    confirm.orphan,
                    confirm.targetMemberId,
                    confirm.targetLabel ?? "member",
                  );
                } else if (confirm.action === "create") {
                  runCreate(confirm.orphan);
                } else if (confirm.action === "ignore") {
                  runIgnore(confirm.orphan);
                }
              }}
            >
              {busy !== null ? "Working…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-background text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}
