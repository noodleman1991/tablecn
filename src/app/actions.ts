"use server";

import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { attendees, events, memberEmailAliases, members } from "@/db/schema";
import {
  type BatchJobState,
  getBatchJob,
  triggerNextChunk,
} from "@/lib/batch-processor";
import { getCacheAge, invalidateCache } from "@/lib/cache-utils";
import { removeMemberFromLoops, syncMemberToLoops } from "@/lib/loops-sync";
import { syncAttendeesForEvent } from "@/lib/sync-attendees";

/**
 * Get all events sorted by date (most recent first)
 * Excludes merged events
 */
export async function getEvents() {
  return await db
    .select()
    .from(events)
    .where(and(isNull(events.mergedIntoEventId), eq(events.status, "active")))
    .orderBy(desc(events.eventDate));
}

/**
 * Get future events (today and onwards) sorted by date (soonest first)
 * Excludes merged events
 */
export async function getFutureEvents() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return await db
    .select()
    .from(events)
    .where(
      and(
        gte(events.eventDate, today),
        isNull(events.mergedIntoEventId),
        eq(events.status, "active"),
      ),
    )
    .orderBy(events.eventDate);
}

/**
 * Get past events (before today) sorted by date (most recent first)
 * Excludes merged events
 */
export async function getPastEvents() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return await db
    .select()
    .from(events)
    .where(
      and(
        lt(events.eventDate, today),
        isNull(events.mergedIntoEventId),
        eq(events.status, "active"),
      ),
    )
    .orderBy(desc(events.eventDate));
}

/**
 * Get a single event by ID
 */
export async function getEventById(eventId: string) {
  const result = await db
    .select()
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  return result[0] || null;
}

/**
 * Get attendees for a specific event
 * Triggers smart sync for today/future events
 */
export async function getAttendeesForEvent(eventId: string) {
  // Trigger sync if needed - don't let sync failures prevent page render
  try {
    await syncAttendeesForEvent(eventId);
  } catch (error) {
    console.error(
      `[getAttendeesForEvent] Sync failed for event ${eventId}, using existing DB data:`,
      error,
    );
  }

  // ALWAYS return fresh data from database
  return await db
    .select()
    .from(attendees)
    .where(eq(attendees.eventId, eventId))
    .orderBy(attendees.email);
}

/**
 * Match attendee to existing member or create new one
 * Returns memberId and whether manual selection is needed
 */
async function matchOrCreateMember(data: {
  email: string;
  firstName: string | null;
  lastName: string | null;
}): Promise<{
  memberId?: string;
  ambiguous?: boolean;
  possibleMatches?: Array<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  }>;
  swapDetected?: boolean;
}> {
  const { email, firstName, lastName } = data;

  // Strategy 1: Exact email match (highest confidence)
  const [exactEmailMatch] = await db
    .select()
    .from(members)
    .where(eq(members.email, email))
    .limit(1);

  if (exactEmailMatch) {
    return { memberId: exactEmailMatch.id };
  }

  // Strategy 2: Name match (if email doesn't match)
  if (firstName && lastName) {
    const nameMatches = await db
      .select()
      .from(members)
      .where(
        and(
          sql`LOWER(${members.firstName}) = LOWER(${firstName})`,
          sql`LOWER(${members.lastName}) = LOWER(${lastName})`,
        ),
      );

    if (nameMatches.length === 1) {
      // Single name match - but different email
      // Return as ambiguous for manual confirmation
      return {
        ambiguous: true,
        possibleMatches: nameMatches.map((m) => ({
          id: m.id,
          email: m.email,
          firstName: m.firstName || "",
          lastName: m.lastName || "",
        })),
      };
    } else if (nameMatches.length > 1) {
      // Multiple name matches
      return {
        ambiguous: true,
        possibleMatches: nameMatches.map((m) => ({
          id: m.id,
          email: m.email,
          firstName: m.firstName || "",
          lastName: m.lastName || "",
        })),
      };
    }
  }

  // Strategy 2.5: Swapped name match (firstName/lastName reversed)
  if (firstName && lastName) {
    const swappedMatches = await db
      .select()
      .from(members)
      .where(
        and(
          sql`LOWER(${members.firstName}) = LOWER(${lastName})`,
          sql`LOWER(${members.lastName}) = LOWER(${firstName})`,
        ),
      );

    if (swappedMatches.length > 0) {
      return {
        ambiguous: true,
        possibleMatches: swappedMatches.map((m) => ({
          id: m.id,
          email: m.email,
          firstName: m.firstName || "",
          lastName: m.lastName || "",
        })),
        swapDetected: true,
      };
    }
  }

  // Strategy 3: No match found - create new member
  const [newMember] = await db
    .insert(members)
    .values({
      email,
      firstName: firstName || "",
      lastName: lastName || "",
      isActiveMember: false, // Will be calculated based on attendance
      totalEventsAttended: 0,
    })
    .returning();

  if (!newMember) {
    throw new Error("Failed to create new member");
  }

  return { memberId: newMember.id };
}

/**
 * Check in an attendee
 */
export async function checkInAttendee(attendeeId: string) {
  "use server";

  // Get attendee details
  const [attendee] = await db
    .select()
    .from(attendees)
    .where(eq(attendees.id, attendeeId))
    .limit(1);

  if (!attendee) {
    throw new Error("Attendee not found");
  }

  // Validate ticket status - reject deleted/cancelled/refunded tickets
  if (
    attendee.orderStatus === "deleted" ||
    attendee.orderStatus === "cancelled" ||
    attendee.orderStatus === "refunded"
  ) {
    throw new Error(`Cannot check in a ${attendee.orderStatus} ticket`);
  }

  // Step 1: Check-in the attendee
  await db
    .update(attendees)
    .set({
      checkedIn: true,
      checkedInAt: new Date(),
    })
    .where(eq(attendees.id, attendeeId));

  // Step 2: Match to community member
  const memberResult = await matchOrCreateMember({
    email: attendee.email,
    firstName: attendee.firstName,
    lastName: attendee.lastName,
  });

  // Step 3: If ambiguous match, return options for user to choose
  if (memberResult.ambiguous) {
    return {
      success: true,
      eventId: attendee.eventId,
      requiresManualMatch: true,
      possibleMatches: memberResult.possibleMatches,
      swapDetected: memberResult.swapDetected,
      attendeeId,
    };
  }

  // Step 4: Recalculate membership status
  if (memberResult.memberId) {
    const { recalculateMembershipForMember } = await import(
      "@/lib/calculate-membership"
    );
    await recalculateMembershipForMember(memberResult.memberId);
  }

  revalidatePath("/");
  return { success: true, eventId: attendee.eventId };
}

/**
 * Manually confirm which member an attendee should be linked to
 * Called when automatic matching is ambiguous
 */
export async function confirmMemberMatch(data: {
  attendeeId: string;
  memberId: string;
}) {
  "use server";

  const { attendeeId, memberId } = data;

  // Get attendee details
  const [attendee] = await db
    .select()
    .from(attendees)
    .where(eq(attendees.id, attendeeId))
    .limit(1);

  if (!attendee) {
    throw new Error("Attendee not found");
  }

  // Get member details
  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);

  if (!member) {
    throw new Error("Member not found");
  }

  // Update attendee email to match member's email
  // This ensures attendance is counted for the correct person
  await db
    .update(attendees)
    .set({
      email: member.email,
      locallyModified: true, // Mark as manually edited
    })
    .where(eq(attendees.id, attendeeId));

  // Recalculate membership status
  const { recalculateMembershipForMember } = await import(
    "@/lib/calculate-membership"
  );
  await recalculateMembershipForMember(memberId);

  revalidatePath("/");
  return { success: true };
}

/**
 * Undo check-in for an attendee
 */
export async function undoCheckIn(attendeeId: string) {
  // Get attendee to return eventId
  const [attendee] = await db
    .select({ eventId: attendees.eventId })
    .from(attendees)
    .where(eq(attendees.id, attendeeId))
    .limit(1);

  await db
    .update(attendees)
    .set({
      checkedIn: false,
      checkedInAt: null,
    })
    .where(eq(attendees.id, attendeeId));

  revalidatePath("/");
  return { success: true, eventId: attendee?.eventId };
}

/**
 * Get all community members sorted by active status and total events
 */
export async function getMembers() {
  return await db
    .select()
    .from(members)
    .orderBy(desc(members.isActiveMember), desc(members.totalEventsAttended));
}

export interface OrphanBooker {
  email: string;
  firstName: string | null;
  lastName: string | null;
  bookerEmail: string | null;
  bookingCount: number;
  latestBooking: Date | null;
  nameMatchMemberId: string | null;
  nameMatchEmail: string | null;
  localPartMatchMemberId: string | null;
  localPartMatchEmail: string | null;
  nameMatchCandidateCount: number;
}

/**
 * Get booking emails that don't match any member and aren't in the alias
 * table. These are the emails that need manual review — genuinely new
 * bookers, typos, or old merged-away emails that haven't been recorded yet.
 *
 * Includes name-match and local-part-match hints computed in SQL (no N+1).
 */
export async function getOrphanBookers(): Promise<OrphanBooker[]> {
  const rows = await db.execute(sql`
    WITH orphan_attendees AS (
      SELECT
        a.email,
        MAX(a.first_name) AS first_name,
        MAX(a.last_name)  AS last_name,
        MAX(a.booker_email) AS booker_email,
        COUNT(*)::int AS booking_count,
        MAX(a.woocommerce_order_date) AS latest_booking
      FROM tablecn_attendees a
      LEFT JOIN tablecn_members m ON m.email = a.email
      LEFT JOIN tablecn_member_email_aliases e ON e.email = a.email
      WHERE m.id IS NULL AND e.id IS NULL
      GROUP BY a.email
    ),
    name_matches AS (
      SELECT
        o.email AS orphan_email,
        (ARRAY_AGG(m2.id))[1] AS member_id,
        (ARRAY_AGG(m2.email))[1] AS member_email,
        COUNT(DISTINCT m2.id)::int AS candidate_count
      FROM orphan_attendees o
      JOIN tablecn_members m2
        ON LOWER(m2.first_name) = LOWER(o.first_name)
       AND LOWER(m2.last_name)  = LOWER(o.last_name)
      WHERE o.first_name IS NOT NULL AND o.last_name IS NOT NULL
      GROUP BY o.email
    ),
    local_part_matches AS (
      SELECT DISTINCT ON (o.email)
        o.email AS orphan_email,
        m3.id AS member_id,
        m3.email AS member_email
      FROM orphan_attendees o
      JOIN tablecn_members m3
        ON SPLIT_PART(m3.email, '@', 1) = SPLIT_PART(o.email, '@', 1)
      ORDER BY o.email, m3.id
    )
    SELECT
      o.email,
      o.first_name,
      o.last_name,
      o.booker_email,
      o.booking_count,
      o.latest_booking,
      n.member_id AS name_match_member_id,
      n.member_email AS name_match_email,
      n.candidate_count AS name_match_candidate_count,
      l.member_id AS local_part_match_member_id,
      l.member_email AS local_part_match_email
    FROM orphan_attendees o
    LEFT JOIN name_matches n ON n.orphan_email = o.email
    LEFT JOIN local_part_matches l ON l.orphan_email = o.email
    ORDER BY o.latest_booking DESC NULLS LAST, o.booking_count DESC
  `);

  return rows.map((r: any) => ({
    email: r.email,
    firstName: r.first_name,
    lastName: r.last_name,
    bookerEmail: r.booker_email,
    bookingCount: Number(r.booking_count),
    latestBooking: r.latest_booking ? new Date(r.latest_booking) : null,
    nameMatchMemberId: r.name_match_member_id,
    nameMatchEmail: r.name_match_email,
    localPartMatchMemberId: r.local_part_match_member_id,
    localPartMatchEmail: r.local_part_match_email,
    nameMatchCandidateCount: r.name_match_candidate_count
      ? Number(r.name_match_candidate_count)
      : 0,
  }));
}

export async function getOrphanBookerCount(): Promise<number> {
  const [row] = await db.execute<{ c: string }>(sql`
    SELECT COUNT(DISTINCT a.email)::text AS c
    FROM tablecn_attendees a
    LEFT JOIN tablecn_members m ON m.email = a.email
    LEFT JOIN tablecn_member_email_aliases e ON e.email = a.email
    WHERE m.id IS NULL AND e.id IS NULL
  `);
  return row ? Number(row.c) : 0;
}

/**
 * Mark an orphan email as "ignored" — not a real member, don't re-surface
 * in review, don't auto-create a member for it at ingest time. Used for
 * typos, test bookings, or people who asked to be forgotten.
 */
export async function ignoreOrphanEmail(email: string, notes?: string) {
  "use server";
  const normalized = email.trim().toLowerCase();

  await db
    .insert(memberEmailAliases)
    .values({
      email: normalized,
      memberId: null,
      status: "ignored",
      source: "manual_add",
      notes: notes ?? null,
    })
    .onConflictDoUpdate({
      target: memberEmailAliases.email,
      set: {
        memberId: null,
        status: "ignored",
        source: "manual_add",
        notes: notes ?? null,
        updatedAt: new Date(),
      },
    });

  revalidatePath("/community-members-list");
  return { success: true };
}

/**
 * Attribute an orphan booking email to an existing member: rewrite all
 * attendee rows with this email to the target member's canonical email,
 * and record the alias. Recalculates the target member's membership stats.
 * Transactional so no half-merged state.
 */
export async function mergeOrphanIntoMember(data: {
  orphanEmail: string;
  targetMemberId: string;
}) {
  "use server";
  const orphanEmail = data.orphanEmail.trim().toLowerCase();
  const { targetMemberId } = data;

  const [target] = await db
    .select()
    .from(members)
    .where(eq(members.id, targetMemberId))
    .limit(1);

  if (!target) {
    throw new Error("Target member not found");
  }

  if (target.email === orphanEmail) {
    throw new Error(
      "Orphan email matches the target member's canonical email — nothing to merge",
    );
  }

  await db.transaction(async (tx) => {
    // Transfer attendee rows: if the target already has an attendee for a
    // given event, preserve the target's row (drop the orphan's) but
    // promote check-in if the orphan was checked in.
    const orphanAttendees = await tx
      .select()
      .from(attendees)
      .where(eq(attendees.email, orphanEmail));

    const targetAttendees = await tx
      .select()
      .from(attendees)
      .where(eq(attendees.email, target.email));

    const targetEventIds = new Set(targetAttendees.map((a) => a.eventId));

    for (const orphan of orphanAttendees) {
      if (targetEventIds.has(orphan.eventId)) {
        const targetAttendee = targetAttendees.find(
          (a) => a.eventId === orphan.eventId,
        );
        if (targetAttendee && orphan.checkedIn && !targetAttendee.checkedIn) {
          await tx
            .update(attendees)
            .set({
              checkedIn: true,
              checkedInAt: orphan.checkedInAt,
            })
            .where(eq(attendees.id, targetAttendee.id));
        }
        await tx.delete(attendees).where(eq(attendees.id, orphan.id));
      } else {
        await tx
          .update(attendees)
          .set({ email: target.email })
          .where(eq(attendees.id, orphan.id));
      }
    }

    await tx
      .insert(memberEmailAliases)
      .values({
        email: orphanEmail,
        memberId: target.id,
        status: "merged",
        source: "manual_merge",
      })
      .onConflictDoUpdate({
        target: memberEmailAliases.email,
        set: {
          memberId: target.id,
          status: "merged",
          source: "manual_merge",
          updatedAt: new Date(),
        },
      });
  });

  // Recalculate target member's stats now that attendees have been transferred
  const { recalculateMembershipForMember } = await import(
    "@/lib/calculate-membership"
  );
  await recalculateMembershipForMember(targetMemberId);

  revalidatePath("/community-members-list");
  return { success: true };
}

/**
 * Promote an orphan booking email into a new, standalone member record.
 * For genuinely new bookers who don't match any existing member.
 */
export async function createMemberFromOrphan(email: string) {
  "use server";
  const normalized = email.trim().toLowerCase();

  // Pick name/address from the most recent attendee record
  const [latest] = await db
    .select()
    .from(attendees)
    .where(eq(attendees.email, normalized))
    .orderBy(desc(attendees.woocommerceOrderDate))
    .limit(1);

  if (!latest) {
    throw new Error(`No attendee rows found for email ${normalized}`);
  }

  await db
    .insert(members)
    .values({
      email: normalized,
      firstName: latest.firstName,
      lastName: latest.lastName,
      isActiveMember: false,
      totalEventsAttended: 0,
      address: latest.billingAddress,
      city: latest.billingCity,
      postcode: latest.billingPostcode,
      country: latest.billingCountry,
      phone: latest.billingPhone,
    })
    .onConflictDoNothing({ target: members.email });

  // Recalculate the newly-created member's stats (may pick up past bookings)
  const { recalculateMembershipByEmail } = await import(
    "@/lib/calculate-membership"
  );
  await recalculateMembershipByEmail(
    normalized,
    latest.firstName,
    latest.lastName,
  );

  revalidatePath("/community-members-list");
  return { success: true };
}

export interface MemberAlias {
  email: string;
  source: string;
  notes: string | null;
  createdAt: Date;
}

/**
 * List all "merged" alias emails for a member — the alternative email
 * addresses that past bookings have been attributed to this member.
 */
export async function getMemberAliases(
  memberId: string,
): Promise<MemberAlias[]> {
  const rows = await db
    .select({
      email: memberEmailAliases.email,
      source: memberEmailAliases.source,
      notes: memberEmailAliases.notes,
      createdAt: memberEmailAliases.createdAt,
    })
    .from(memberEmailAliases)
    .where(
      and(
        eq(memberEmailAliases.memberId, memberId),
        eq(memberEmailAliases.status, "merged"),
      ),
    )
    .orderBy(desc(memberEmailAliases.createdAt));

  return rows.map((r) => ({
    email: r.email,
    source: r.source,
    notes: r.notes,
    createdAt: r.createdAt,
  }));
}

/**
 * Attach an alternative email to an existing member. Rewrites any attendee
 * rows currently under the alias email to the member's canonical email, so
 * past bookings count toward the member immediately. Transactional.
 */
export async function addMemberAlias(data: {
  memberId: string;
  email: string;
}) {
  "use server";
  const aliasEmail = data.email.trim().toLowerCase();
  if (!aliasEmail.includes("@")) {
    throw new Error("Enter a valid email address");
  }

  const [target] = await db
    .select()
    .from(members)
    .where(eq(members.id, data.memberId))
    .limit(1);
  if (!target) throw new Error("Member not found");

  if (target.email === aliasEmail) {
    throw new Error("That is already this member's primary email");
  }

  const [existingMember] = await db
    .select({ id: members.id, email: members.email })
    .from(members)
    .where(eq(members.email, aliasEmail))
    .limit(1);
  if (existingMember) {
    throw new Error(
      `Another member already uses ${aliasEmail} as their primary email. Merge them instead.`,
    );
  }

  const [existingAlias] = await db
    .select()
    .from(memberEmailAliases)
    .where(eq(memberEmailAliases.email, aliasEmail))
    .limit(1);
  if (
    existingAlias &&
    existingAlias.memberId &&
    existingAlias.memberId !== data.memberId
  ) {
    throw new Error(
      `${aliasEmail} is already linked to a different member. Unlink there first.`,
    );
  }

  await db.transaction(async (tx) => {
    const aliasAttendees = await tx
      .select()
      .from(attendees)
      .where(eq(attendees.email, aliasEmail));

    const targetAttendees = await tx
      .select()
      .from(attendees)
      .where(eq(attendees.email, target.email));

    const targetEventIds = new Set(targetAttendees.map((a) => a.eventId));

    for (const orphan of aliasAttendees) {
      if (targetEventIds.has(orphan.eventId)) {
        const targetAttendee = targetAttendees.find(
          (a) => a.eventId === orphan.eventId,
        );
        if (targetAttendee && orphan.checkedIn && !targetAttendee.checkedIn) {
          await tx
            .update(attendees)
            .set({ checkedIn: true, checkedInAt: orphan.checkedInAt })
            .where(eq(attendees.id, targetAttendee.id));
        }
        await tx.delete(attendees).where(eq(attendees.id, orphan.id));
      } else {
        await tx
          .update(attendees)
          .set({ email: target.email })
          .where(eq(attendees.id, orphan.id));
      }
    }

    await tx
      .insert(memberEmailAliases)
      .values({
        email: aliasEmail,
        memberId: target.id,
        status: "merged",
        source: "manual_add",
      })
      .onConflictDoUpdate({
        target: memberEmailAliases.email,
        set: {
          memberId: target.id,
          status: "merged",
          source: "manual_add",
          updatedAt: new Date(),
        },
      });
  });

  const { recalculateMembershipForMember } = await import(
    "@/lib/calculate-membership"
  );
  await recalculateMembershipForMember(data.memberId);

  revalidatePath("/community-members-list");
  return { success: true };
}

/**
 * Remove an alias row entirely. Treats unlink as "undo mistake" — if a
 * booking arrives from this email later, it will reappear in Needs Review
 * for fresh triage. Does NOT move attendees back: past bookings stay on the
 * member (that rewrite is not reversible from here).
 */
export async function unlinkMemberAlias(email: string) {
  "use server";
  const normalized = email.trim().toLowerCase();

  await db
    .delete(memberEmailAliases)
    .where(eq(memberEmailAliases.email, normalized));

  revalidatePath("/community-members-list");
  return { success: true };
}

/**
 * Promote an existing alias to the member's primary email, demoting the old
 * primary into an alias row. Keeps the canonical-email invariant on attendees:
 * past bookings get rewritten to the new primary in the same transaction, so
 * attendance counts stay correct. Loops contact is moved after commit when the
 * member is active (remove old → sync new) since Loops keys contacts by email.
 */
export async function setMemberPrimaryEmail(data: {
  memberId: string;
  newPrimaryEmail: string;
}) {
  "use server";
  const newPrimary = data.newPrimaryEmail.trim().toLowerCase();
  if (!newPrimary.includes("@")) {
    throw new Error("Enter a valid email address");
  }

  const [target] = await db
    .select()
    .from(members)
    .where(eq(members.id, data.memberId))
    .limit(1);
  if (!target) throw new Error("Member not found");

  const oldPrimary = target.email;
  if (oldPrimary === newPrimary) {
    throw new Error("That is already this member's primary email");
  }

  const [aliasRow] = await db
    .select()
    .from(memberEmailAliases)
    .where(eq(memberEmailAliases.email, newPrimary))
    .limit(1);
  if (
    !aliasRow ||
    aliasRow.memberId !== data.memberId ||
    aliasRow.status !== "merged"
  ) {
    throw new Error(
      `${newPrimary} is not an alternative email for this member. Add it first, then set as primary.`,
    );
  }

  const [conflictMember] = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.email, newPrimary))
    .limit(1);
  if (conflictMember && conflictMember.id !== data.memberId) {
    throw new Error(
      `Another member already uses ${newPrimary} as their primary email.`,
    );
  }

  await db.transaction(async (tx) => {
    const oldPrimaryAttendees = await tx
      .select()
      .from(attendees)
      .where(eq(attendees.email, oldPrimary));

    const newPrimaryAttendees = await tx
      .select()
      .from(attendees)
      .where(eq(attendees.email, newPrimary));

    const newPrimaryEventIds = new Set(
      newPrimaryAttendees.map((a) => a.eventId),
    );

    for (const row of oldPrimaryAttendees) {
      if (newPrimaryEventIds.has(row.eventId)) {
        const keep = newPrimaryAttendees.find(
          (a) => a.eventId === row.eventId,
        );
        if (keep && row.checkedIn && !keep.checkedIn) {
          await tx
            .update(attendees)
            .set({ checkedIn: true, checkedInAt: row.checkedInAt })
            .where(eq(attendees.id, keep.id));
        }
        await tx.delete(attendees).where(eq(attendees.id, row.id));
      } else {
        await tx
          .update(attendees)
          .set({ email: newPrimary })
          .where(eq(attendees.id, row.id));
      }
    }

    await tx
      .update(members)
      .set({ email: newPrimary })
      .where(eq(members.id, data.memberId));

    await tx
      .delete(memberEmailAliases)
      .where(eq(memberEmailAliases.email, newPrimary));

    await tx
      .insert(memberEmailAliases)
      .values({
        email: oldPrimary,
        memberId: data.memberId,
        status: "merged",
        source: "manual_primary_swap",
      })
      .onConflictDoUpdate({
        target: memberEmailAliases.email,
        set: {
          memberId: data.memberId,
          status: "merged",
          source: "manual_primary_swap",
          updatedAt: new Date(),
        },
      });
  });

  const { recalculateMembershipForMember } = await import(
    "@/lib/calculate-membership"
  );
  await recalculateMembershipForMember(data.memberId);

  const [updatedMember] = await db
    .select()
    .from(members)
    .where(eq(members.id, data.memberId))
    .limit(1);

  if (updatedMember?.isActiveMember) {
    try {
      await removeMemberFromLoops(oldPrimary, data.memberId);
      await syncMemberToLoops(updatedMember);
    } catch (error) {
      console.error(
        `[setMemberPrimaryEmail] Loops sync failed for ${data.memberId} (${oldPrimary} → ${newPrimary}):`,
        error,
      );
    }
  }

  revalidatePath("/community-members-list");
  return { success: true };
}

/**
 * Manually create a new community member
 */
export async function createManualMember(data: {
  email: string;
  firstName: string;
  lastName: string;
  notes?: string;
  manualExpiresAt?: Date;
}) {
  "use server";

  // Validate email doesn't already exist
  const existingMember = await db
    .select()
    .from(members)
    .where(eq(members.email, data.email.toLowerCase().trim()))
    .limit(1);

  if (existingMember.length > 0) {
    throw new Error("A member with this email already exists");
  }

  // Create manual member
  const newMember = await db
    .insert(members)
    .values({
      email: data.email.toLowerCase().trim(),
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
      notes: data.notes?.trim() || null,
      manuallyAdded: true,
      manualExpiresAt: data.manualExpiresAt || null,
      isActiveMember: true,
      totalEventsAttended: 0,
    })
    .returning();

  // Sync to Loops.so since manually created members are always active
  if (newMember[0]) {
    await syncMemberToLoops(newMember[0]);
  }

  revalidatePath("/community-members-list");

  return {
    success: true,
    member: newMember[0],
  };
}

/**
 * Update member details (name, email, notes, manual expiration)
 */
export async function updateMemberDetails(data: {
  memberId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  address?: string;
  city?: string;
  postcode?: string;
  country?: string;
  phone?: string;
  notes?: string;
  manualExpiresAt?: Date | null;
}) {
  "use server";

  const { memberId, ...updates } = data;

  // If email is being updated, check it doesn't conflict
  if (updates.email) {
    const existingMember = await db
      .select()
      .from(members)
      .where(eq(members.email, updates.email.toLowerCase().trim()))
      .limit(1);

    if (existingMember.length > 0 && existingMember[0]?.id !== memberId) {
      throw new Error("A member with this email already exists");
    }
  }

  // Build update object
  const updateData: any = {};
  if (updates.email !== undefined)
    updateData.email = updates.email.toLowerCase().trim();
  if (updates.firstName !== undefined)
    updateData.firstName = updates.firstName.trim();
  if (updates.lastName !== undefined)
    updateData.lastName = updates.lastName.trim();
  if (updates.address !== undefined)
    updateData.address = updates.address.trim() || null;
  if (updates.city !== undefined) updateData.city = updates.city.trim() || null;
  if (updates.postcode !== undefined)
    updateData.postcode = updates.postcode.trim() || null;
  if (updates.country !== undefined)
    updateData.country = updates.country.trim() || null;
  if (updates.phone !== undefined)
    updateData.phone = updates.phone.trim() || null;
  if (updates.notes !== undefined)
    updateData.notes = updates.notes?.trim() || null;
  if (updates.manualExpiresAt !== undefined)
    updateData.manualExpiresAt = updates.manualExpiresAt;

  const [updatedMember] = await db
    .update(members)
    .set(updateData)
    .where(eq(members.id, memberId))
    .returning();

  // Sync to Loops.so if member is active
  if (updatedMember?.isActiveMember) {
    await syncMemberToLoops(updatedMember);
  }

  revalidatePath("/community-members-list");

  return { success: true };
}

/**
 * Toggle member status override with optional expiration
 */
export async function toggleMemberStatusOverride(data: {
  memberId: string;
  forceActive?: boolean;
  forceInactive?: boolean;
  expiresAt?: Date | null;
}) {
  "use server";

  const { memberId, forceActive, forceInactive, expiresAt } = data;

  // Update member with status override
  const updateData: any = {};

  if (forceActive) {
    updateData.isActiveMember = true;
    updateData.manuallyAdded = true;
    updateData.manualExpiresAt = expiresAt || null;
  } else if (forceInactive) {
    updateData.isActiveMember = false;
    updateData.manualExpiresAt = expiresAt || null;
  } else {
    // Clear override - recalculate based on attendance
    const member = await db
      .select()
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1);

    if (member.length > 0) {
      const { recalculateMembershipForMember } = await import(
        "@/lib/calculate-membership"
      );
      await recalculateMembershipForMember(memberId);
      revalidatePath("/community-members-list");
      return { success: true };
    }
  }

  const [updatedMember] = await db
    .update(members)
    .set(updateData)
    .where(eq(members.id, memberId))
    .returning();

  // Sync to Loops.so based on new status
  if (updatedMember) {
    if (updatedMember.isActiveMember) {
      await syncMemberToLoops(updatedMember);
    } else {
      await removeMemberFromLoops(updatedMember.email, updatedMember.id);
    }
  }

  revalidatePath("/community-members-list");

  return { success: true };
}

/**
 * Delete a member
 */
export async function deleteMember(memberId: string) {
  "use server";

  // Get member email before deletion for Loops sync
  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);

  if (member) {
    // Remove from Loops.so before deletion
    await removeMemberFromLoops(member.email, member.id);
  }

  await db.delete(members).where(eq(members.id, memberId));

  revalidatePath("/community-members-list");

  return { success: true };
}

/**
 * Merge two member records
 * Keeps the primary member and transfers all attendee records from secondary
 * Also removes duplicate attendees for the same event after merge
 */
export async function mergeMemberRecords(data: {
  primaryMemberId: string;
  secondaryMemberId: string;
}) {
  "use server";

  const { primaryMemberId, secondaryMemberId } = data;

  // Get both members
  const primaryMember = await db
    .select()
    .from(members)
    .where(eq(members.id, primaryMemberId))
    .limit(1);

  const secondaryMember = await db
    .select()
    .from(members)
    .where(eq(members.id, secondaryMemberId))
    .limit(1);

  const primary = primaryMember[0];
  const secondary = secondaryMember[0];

  if (!primary || !secondary) {
    throw new Error("One or both members not found");
  }

  // Transactional block: attendee transfer + alias record + secondary delete
  // run together. Loops removal happens AFTER commit because it's an external
  // HTTP call and must not hold a DB transaction.
  await db.transaction(async (tx) => {
    // Get all attendee records from secondary member
    const secondaryAttendees = await tx
      .select()
      .from(attendees)
      .where(eq(attendees.email, secondary.email));

    // Get all attendee records from primary member
    const primaryAttendees = await tx
      .select()
      .from(attendees)
      .where(eq(attendees.email, primary.email));

    // Create a set of event IDs the primary already has
    const primaryEventIds = new Set(primaryAttendees.map((a) => a.eventId));

    // For each secondary attendee, either transfer or merge into existing
    for (const secondaryAttendee of secondaryAttendees) {
      if (primaryEventIds.has(secondaryAttendee.eventId)) {
        // Primary already has an attendee for this event - check if we need to preserve check-in
        const primaryAttendee = primaryAttendees.find(
          (a) => a.eventId === secondaryAttendee.eventId,
        );

        if (
          primaryAttendee &&
          secondaryAttendee.checkedIn &&
          !primaryAttendee.checkedIn
        ) {
          // Secondary was checked in but primary wasn't - update primary's check-in status
          await tx
            .update(attendees)
            .set({
              checkedIn: true,
              checkedInAt: secondaryAttendee.checkedInAt,
            })
            .where(eq(attendees.id, primaryAttendee.id));
        }

        // Delete the duplicate secondary attendee
        await tx
          .delete(attendees)
          .where(eq(attendees.id, secondaryAttendee.id));
      } else {
        // No duplicate - just transfer the email
        await tx
          .update(attendees)
          .set({ email: primary.email })
          .where(eq(attendees.id, secondaryAttendee.id));
      }
    }

    // Record the merge in the alias table so future bookings from the
    // secondary email are auto-attributed to the primary member. Idempotent:
    // re-merging updates the existing row instead of failing.
    await tx
      .insert(memberEmailAliases)
      .values({
        email: secondary.email,
        memberId: primary.id,
        status: "merged",
        source: "manual_merge",
      })
      .onConflictDoUpdate({
        target: memberEmailAliases.email,
        set: {
          memberId: primary.id,
          status: "merged",
          source: "manual_merge",
          updatedAt: new Date(),
        },
      });

    // Delete secondary member
    await tx.delete(members).where(eq(members.id, secondaryMemberId));
  });

  // Remove from Loops AFTER the transaction commits. External HTTP calls
  // must never run inside a DB transaction. If Loops removal fails, the DB
  // state is already correct; Loops can be reconciled later.
  await removeMemberFromLoops(secondary.email, secondary.id);

  // Recalculate primary member's stats
  const { recalculateMembershipForMember } = await import(
    "@/lib/calculate-membership"
  );
  await recalculateMembershipForMember(primaryMemberId);

  revalidatePath("/community-members-list");

  return { success: true };
}

/**
 * Force refresh attendees from WooCommerce
 * Bypasses cache and re-syncs data
 */
export async function refreshAttendeesForEvent(eventId: string) {
  await syncAttendeesForEvent(eventId, true); // forceRefresh = true
  revalidatePath("/");
  return { success: true };
}

/**
 * Re-sync all events that have a WooCommerce product ID
 * Bypasses cutoff so past events are also re-synced from WooCommerce
 */
export async function resyncAllEvents() {
  "use server";

  const { redis } = await import("@/lib/redis");

  // In dev, use after() to free the single-threaded dev server before the self-fetch
  if (process.env.NODE_ENV === "development") {
    const { after } = await import("next/server");
    after(() => triggerNextChunk("/api/batch/resync-events"));
    return { success: true, batchJobStarted: true, progressTrackable: !!redis };
  }

  try {
    const res = await triggerNextChunk("/api/batch/resync-events");
    console.log(
      `[resyncAllEvents] Trigger response: ${res.status} ${res.statusText}`,
    );
    return { success: true, batchJobStarted: true, progressTrackable: !!redis };
  } catch (error) {
    console.error("[resyncAllEvents] Failed to trigger batch:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Re-sync events within a specific date range
 */
export async function resyncByPeriod(dateFrom: string, dateTo: string) {
  "use server";

  const { redis } = await import("@/lib/redis");

  try {
    const res = await triggerNextChunk("/api/batch/resync-events", {
      dateFrom,
      dateTo,
    });
    console.log(
      `[resyncByPeriod] Trigger response: ${res.status} (${dateFrom} to ${dateTo})`,
    );
    return { success: true, batchJobStarted: true, progressTrackable: !!redis };
  } catch (error) {
    console.error("[resyncByPeriod] Failed to trigger batch:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Re-sync events starting from a specific offset (resume after failure)
 */
export async function resyncFromOffset(startFromOffset: number) {
  "use server";

  const { redis } = await import("@/lib/redis");

  try {
    const res = await triggerNextChunk("/api/batch/resync-events", {
      startFromOffset,
    });
    console.log(
      `[resyncFromOffset] Trigger response: ${res.status} (offset: ${startFromOffset})`,
    );
    return { success: true, batchJobStarted: true, progressTrackable: !!redis };
  } catch (error) {
    console.error("[resyncFromOffset] Failed to trigger batch:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get the current status of a batch job by type
 * Used by client components to poll batch progress without exposing CRON_SECRET
 */
export async function getBatchStatus(
  type: string,
): Promise<BatchJobState | null> {
  "use server";
  return await getBatchJob(type);
}

/**
 * Check if a swapped name match exists for given first/last name
 * Used by the add-manual-member dialog to warn about potential name swaps
 */
export async function checkSwappedNameMatch(
  firstName: string,
  lastName: string,
) {
  "use server";

  if (!firstName || !lastName) return { matches: [] };

  const swappedMatches = await db
    .select()
    .from(members)
    .where(
      and(
        sql`LOWER(${members.firstName}) = LOWER(${lastName})`,
        sql`LOWER(${members.lastName}) = LOWER(${firstName})`,
      ),
    );

  return {
    matches: swappedMatches.map((m) => ({
      id: m.id,
      email: m.email,
      firstName: m.firstName || "",
      lastName: m.lastName || "",
    })),
  };
}

/**
 * Get lowercased emails of active community members who are attendees for a given event
 */
export async function getCommunityMemberEmailsForEvent(
  eventId: string,
): Promise<string[]> {
  const rows = await db.execute<{ email: string }>(sql`
    SELECT DISTINCT LOWER(m.email) AS email
    FROM ${members} m
    INNER JOIN ${attendees} a ON LOWER(m.email) = LOWER(a.email)
    WHERE a.event_id = ${eventId} AND m.is_active_member = true
  `);

  return (rows as any[]).map((r) => r.email);
}

/**
 * Get cache age for event sync in seconds
 * Returns null if no cache exists or cache is expired
 */
export async function getSyncCacheAge(eventId: string): Promise<number | null> {
  const cacheKey = `sync:event:${eventId}`;
  return await getCacheAge(cacheKey);
}

/**
 * Helper: Upsert member record
 */
async function upsertMemberHelper(
  email: string,
  firstName: string,
  lastName: string,
) {
  const existing = await db
    .select()
    .from(members)
    .where(eq(members.email, email))
    .limit(1);

  const existingMember = existing[0];
  if (!existingMember) {
    // Create new member
    await db.insert(members).values({
      email,
      firstName,
      lastName,
      isActiveMember: false,
      totalEventsAttended: 0,
    });
  } else {
    // Update name if provided and different
    if (firstName || lastName) {
      await db
        .update(members)
        .set({
          firstName: firstName || existingMember.firstName,
          lastName: lastName || existingMember.lastName,
        })
        .where(eq(members.id, existingMember.id));
    }
  }
}

/**
 * Create a manual attendee (door purchase)
 * Auto-creates member record
 */
export async function createManualAttendee(data: {
  eventId: string;
  email: string;
  firstName: string;
  lastName: string;
  checkedIn: boolean;
}) {
  "use server";

  const normalizedEmail = data.email.toLowerCase().trim();

  // Check for duplicate
  const existing = await db
    .select()
    .from(attendees)
    .where(
      and(
        eq(attendees.eventId, data.eventId),
        eq(attendees.email, normalizedEmail),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    throw new Error("This email is already registered for this event");
  }

  // 1. Create attendee record
  const newAttendee = await db
    .insert(attendees)
    .values({
      eventId: data.eventId,
      email: normalizedEmail,
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
      ticketId: null, // Manual entry has no WooCommerce ticket
      woocommerceOrderId: null, // Manual entry has no WooCommerce order
      manuallyAdded: true,
      locallyModified: false,
      checkedIn: data.checkedIn,
      checkedInAt: data.checkedIn ? new Date() : null,
    })
    .returning();

  // 2. Auto-create/update member record
  await upsertMemberHelper(
    normalizedEmail,
    data.firstName.trim(),
    data.lastName.trim(),
  );

  revalidatePath("/");

  return {
    success: true,
    attendee: newAttendee[0],
    eventId: data.eventId,
  };
}

/**
 * Update attendee details with smart member merging
 * Sets locallyModified flag to protect from WooCommerce sync overwrites
 */
export async function updateAttendeeDetails(
  attendeeId: string,
  field: "email" | "firstName" | "lastName",
  value: string,
) {
  "use server";

  const normalizedValue =
    field === "email" ? value.toLowerCase().trim() : value.trim();

  // Get current attendee
  const [currentAttendee] = await db
    .select()
    .from(attendees)
    .where(eq(attendees.id, attendeeId))
    .limit(1);

  if (!currentAttendee) {
    throw new Error("Attendee not found");
  }

  // Check if email is changing
  const emailChanged =
    field === "email" && normalizedValue !== currentAttendee.email;

  if (emailChanged) {
    // Check if new email already exists in members table
    const [existingMember] = await db
      .select()
      .from(members)
      .where(eq(members.email, normalizedValue))
      .limit(1);

    if (existingMember) {
      // Update existing member's data
      // Don't create duplicate member
      console.log(
        `[update-attendee] Email ${normalizedValue} exists in members, updating that member's record`,
      );
    } else {
      // Create new member record for new email
      await upsertMemberHelper(
        normalizedValue,
        currentAttendee.firstName || "",
        currentAttendee.lastName || "",
      );
    }
  }

  // Update attendee record
  await db
    .update(attendees)
    .set({
      [field]: normalizedValue,
      locallyModified: true, // Mark as edited
    })
    .where(eq(attendees.id, attendeeId));

  // Recalculate membership when email changes
  // This ensures attendance counts are correct for both old and new email addresses
  if (emailChanged) {
    const { recalculateMembershipForMember } = await import(
      "@/lib/calculate-membership"
    );

    // Recalculate for the NEW email's member
    const [newMember] = await db
      .select()
      .from(members)
      .where(eq(members.email, normalizedValue))
      .limit(1);

    if (newMember) {
      await recalculateMembershipForMember(newMember.id);
    }

    // Recalculate for the OLD email's member (they may have lost an attendance)
    const [oldMember] = await db
      .select()
      .from(members)
      .where(eq(members.email, currentAttendee.email))
      .limit(1);

    if (oldMember) {
      await recalculateMembershipForMember(oldMember.id);
    }
  }

  revalidatePath("/");

  return { success: true, eventId: currentAttendee.eventId };
}

/**
 * Soft delete an attendee record (sets orderStatus to "deleted")
 * The attendee remains visible in the UI with strikethrough styling
 */
export async function deleteAttendee(attendeeId: string) {
  "use server";

  // Get the attendee to find their eventId for cache invalidation
  const [attendee] = await db
    .select({ eventId: attendees.eventId })
    .from(attendees)
    .where(eq(attendees.id, attendeeId))
    .limit(1);

  await db
    .update(attendees)
    .set({ orderStatus: "deleted" })
    .where(eq(attendees.id, attendeeId));

  // Invalidate the sync cache so the UI shows fresh data
  if (attendee?.eventId) {
    await invalidateCache(`sync:event:${attendee.eventId}`);
  }

  revalidatePath("/");

  return { success: true, eventId: attendee?.eventId };
}

/**
 * Soft delete an entire order (all tickets with same woocommerceOrderId)
 * Sets orderStatus to "deleted" for all attendees in the order
 */
export async function deleteOrder(woocommerceOrderId: string) {
  "use server";

  // Get one attendee to find the eventId for cache invalidation
  const [attendee] = await db
    .select({ eventId: attendees.eventId })
    .from(attendees)
    .where(eq(attendees.woocommerceOrderId, woocommerceOrderId))
    .limit(1);

  await db
    .update(attendees)
    .set({ orderStatus: "deleted" })
    .where(eq(attendees.woocommerceOrderId, woocommerceOrderId));

  // Invalidate the sync cache so the UI shows fresh data
  if (attendee?.eventId) {
    await invalidateCache(`sync:event:${attendee.eventId}`);
  }

  revalidatePath("/");

  return { success: true, eventId: attendee?.eventId };
}

/**
 * Merge two attendee records
 * Keeps primary attendee, transfers check-in status from secondary if needed, then deletes secondary
 */
export async function mergeAttendeeRecords(data: {
  primaryAttendeeId: string;
  secondaryAttendeeId: string;
}) {
  "use server";

  const { primaryAttendeeId, secondaryAttendeeId } = data;

  // Get both attendees
  const [primary] = await db
    .select()
    .from(attendees)
    .where(eq(attendees.id, primaryAttendeeId))
    .limit(1);

  const [secondary] = await db
    .select()
    .from(attendees)
    .where(eq(attendees.id, secondaryAttendeeId))
    .limit(1);

  if (!primary || !secondary) {
    throw new Error("One or both attendees not found");
  }

  // Keep primary's data, but preserve check-in status if secondary was checked in
  if (secondary.checkedIn && !primary.checkedIn) {
    await db
      .update(attendees)
      .set({
        checkedIn: true,
        checkedInAt: secondary.checkedInAt,
      })
      .where(eq(attendees.id, primaryAttendeeId));
  }

  // Delete secondary attendee
  await db.delete(attendees).where(eq(attendees.id, secondaryAttendeeId));

  revalidatePath("/");

  return { success: true, eventId: primary.eventId };
}

/**
 * Swap firstName and lastName for a single attendee
 * Marks the attendee as locallyModified to protect from sync overwrites
 * Also updates the corresponding member record if names match pre-swap values
 */
export async function swapAttendeeName(attendeeId: string) {
  "use server";

  const [attendee] = await db
    .select()
    .from(attendees)
    .where(eq(attendees.id, attendeeId))
    .limit(1);

  if (!attendee) {
    throw new Error("Attendee not found");
  }

  const oldFirst = attendee.firstName;
  const oldLast = attendee.lastName;

  // Swap the names
  await db
    .update(attendees)
    .set({
      firstName: oldLast,
      lastName: oldFirst,
      locallyModified: true,
    })
    .where(eq(attendees.id, attendeeId));

  // Update member record if the member's name matches pre-swap values
  if (attendee.email) {
    const [member] = await db
      .select()
      .from(members)
      .where(eq(members.email, attendee.email))
      .limit(1);

    if (
      member &&
      member.firstName === oldFirst &&
      member.lastName === oldLast
    ) {
      await db
        .update(members)
        .set({
          firstName: oldLast,
          lastName: oldFirst,
        })
        .where(eq(members.id, member.id));

      // Sync to Loops if active
      if (member.isActiveMember) {
        const updatedMember = {
          ...member,
          firstName: oldLast,
          lastName: oldFirst,
        };
        await syncMemberToLoops(updatedMember);
      }
    }
  }

  revalidatePath("/");
  return { success: true, eventId: attendee.eventId };
}

/**
 * Swap firstName and lastName for a single member
 * Also updates all matching attendee records
 * Syncs to Loops if member is active
 */
export async function swapMemberName(memberId: string) {
  "use server";

  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);

  if (!member) {
    throw new Error("Member not found");
  }

  const oldFirst = member.firstName;
  const oldLast = member.lastName;

  // Swap the member's names
  const [updatedMember] = await db
    .update(members)
    .set({
      firstName: oldLast,
      lastName: oldFirst,
    })
    .where(eq(members.id, memberId))
    .returning();

  // Update all attendee records with matching email where names match pre-swap values
  const matchingAttendees = await db
    .select()
    .from(attendees)
    .where(eq(attendees.email, member.email));

  for (const att of matchingAttendees) {
    if (att.firstName === oldFirst && att.lastName === oldLast) {
      await db
        .update(attendees)
        .set({
          firstName: oldLast,
          lastName: oldFirst,
        })
        .where(eq(attendees.id, att.id));
    }
  }

  // Sync to Loops if active
  if (updatedMember?.isActiveMember) {
    await syncMemberToLoops(updatedMember);
  }

  revalidatePath("/");
  revalidatePath("/community-members-list");

  return { success: true };
}

/**
 * Bulk swap firstName/lastName for multiple attendees or members
 */
export async function bulkSwapNames(
  ids: string[],
  type: "attendee" | "member",
) {
  "use server";

  const results: Array<{ id: string; success: boolean; error?: string }> = [];

  for (const id of ids) {
    try {
      if (type === "attendee") {
        await swapAttendeeName(id);
      } else {
        await swapMemberName(id);
      }
      results.push({ id, success: true });
    } catch (error) {
      results.push({
        id,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  revalidatePath("/");
  revalidatePath("/community-members-list");

  const successCount = results.filter((r) => r.success).length;
  return { success: true, total: ids.length, swapped: successCount, results };
}
