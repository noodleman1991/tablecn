"use server";

import { db } from "@/db";
import { attendees, events, members } from "@/db/schema";
import { eq, desc, gte, lt, isNull, and, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { syncAttendeesForEvent } from "@/lib/sync-attendees";
import { getCacheAge, invalidateCache } from "@/lib/cache-utils";
import { syncMemberToLoops, removeMemberFromLoops } from "@/lib/loops-sync";

/**
 * Get all events sorted by date (most recent first)
 * Excludes merged events
 */
export async function getEvents() {
  return await db
    .select()
    .from(events)
    .where(isNull(events.mergedIntoEventId))
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
        isNull(events.mergedIntoEventId)
      )
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
        isNull(events.mergedIntoEventId)
      )
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
  // Sync attendees if event is today or in the future
  const syncResult = await syncAttendeesForEvent(eventId);

  // If sync returned cached attendees, use them
  if (syncResult.reason === 'cached' && syncResult.cachedAttendees) {
    return syncResult.cachedAttendees;
  }

  // Otherwise, fresh sync happened - query database
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
  possibleMatches?: Array<{ id: string; email: string; firstName: string; lastName: string }>;
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
          sql`LOWER(${members.lastName}) = LOWER(${lastName})`
        )
      );

    if (nameMatches.length === 1) {
      // Single name match - but different email
      // Return as ambiguous for manual confirmation
      return {
        ambiguous: true,
        possibleMatches: nameMatches.map(m => ({
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
        possibleMatches: nameMatches.map(m => ({
          id: m.id,
          email: m.email,
          firstName: m.firstName || "",
          lastName: m.lastName || "",
        })),
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
      requiresManualMatch: true,
      possibleMatches: memberResult.possibleMatches,
      attendeeId,
    };
  }

  // Step 4: Recalculate membership status
  if (memberResult.memberId) {
    const { recalculateMembershipForMember } = await import("@/lib/calculate-membership");
    await recalculateMembershipForMember(memberResult.memberId);
  }

  revalidatePath("/");
  return { success: true };
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
  const { recalculateMembershipForMember } = await import("@/lib/calculate-membership");
  await recalculateMembershipForMember(memberId);

  revalidatePath("/");
  return { success: true };
}

/**
 * Undo check-in for an attendee
 */
export async function undoCheckIn(attendeeId: string) {
  await db
    .update(attendees)
    .set({
      checkedIn: false,
      checkedInAt: null,
    })
    .where(eq(attendees.id, attendeeId));

  revalidatePath("/");
  return { success: true };
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
  if (updates.email !== undefined) updateData.email = updates.email.toLowerCase().trim();
  if (updates.firstName !== undefined) updateData.firstName = updates.firstName.trim();
  if (updates.lastName !== undefined) updateData.lastName = updates.lastName.trim();
  if (updates.notes !== undefined) updateData.notes = updates.notes?.trim() || null;
  if (updates.manualExpiresAt !== undefined) updateData.manualExpiresAt = updates.manualExpiresAt;

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
      const { recalculateMembershipForMember } = await import("@/lib/calculate-membership");
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

  // Get all attendee records from secondary member
  const secondaryAttendees = await db
    .select()
    .from(attendees)
    .where(eq(attendees.email, secondary.email));

  // Get all attendee records from primary member
  const primaryAttendees = await db
    .select()
    .from(attendees)
    .where(eq(attendees.email, primary.email));

  // Create a set of event IDs the primary already has
  const primaryEventIds = new Set(primaryAttendees.map(a => a.eventId));

  // For each secondary attendee, either transfer or merge into existing
  for (const secondaryAttendee of secondaryAttendees) {
    if (primaryEventIds.has(secondaryAttendee.eventId)) {
      // Primary already has an attendee for this event - check if we need to preserve check-in
      const primaryAttendee = primaryAttendees.find(a => a.eventId === secondaryAttendee.eventId);

      if (primaryAttendee && secondaryAttendee.checkedIn && !primaryAttendee.checkedIn) {
        // Secondary was checked in but primary wasn't - update primary's check-in status
        await db
          .update(attendees)
          .set({
            checkedIn: true,
            checkedInAt: secondaryAttendee.checkedInAt,
          })
          .where(eq(attendees.id, primaryAttendee.id));
      }

      // Delete the duplicate secondary attendee
      await db.delete(attendees).where(eq(attendees.id, secondaryAttendee.id));
    } else {
      // No duplicate - just transfer the email
      await db
        .update(attendees)
        .set({ email: primary.email })
        .where(eq(attendees.id, secondaryAttendee.id));
    }
  }

  // Remove from Loops before deletion
  await removeMemberFromLoops(secondary.email, secondary.id);

  // Delete secondary member
  await db.delete(members).where(eq(members.id, secondaryMemberId));

  // Recalculate primary member's stats
  const { recalculateMembershipForMember } = await import("@/lib/calculate-membership");
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
        eq(attendees.email, normalizedEmail)
      )
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
    data.lastName.trim()
  );

  revalidatePath("/");

  return {
    success: true,
    attendee: newAttendee[0],
  };
}

/**
 * Update attendee details with smart member merging
 * Sets locallyModified flag to protect from WooCommerce sync overwrites
 */
export async function updateAttendeeDetails(
  attendeeId: string,
  field: "email" | "firstName" | "lastName",
  value: string
) {
  "use server";

  const normalizedValue = field === "email" ? value.toLowerCase().trim() : value.trim();

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
  const emailChanged = field === "email" && normalizedValue !== currentAttendee.email;

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
        `[update-attendee] Email ${normalizedValue} exists in members, updating that member's record`
      );
    } else {
      // Create new member record for new email
      await upsertMemberHelper(
        normalizedValue,
        currentAttendee.firstName || "",
        currentAttendee.lastName || ""
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

  revalidatePath("/");

  return { success: true };
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

  return { success: true };
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

  return { success: true };
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

  return { success: true };
}
