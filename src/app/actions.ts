"use server";

import { db } from "@/db";
import { attendees, events, members } from "@/db/schema";
import { eq, desc, gte, lt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { syncAttendeesForEvent } from "@/lib/sync-attendees";
import { getCacheAge } from "@/lib/cache-utils";

/**
 * Get all events sorted by date (most recent first)
 */
export async function getEvents() {
  return await db.select().from(events).orderBy(desc(events.eventDate));
}

/**
 * Get future events (today and onwards) sorted by date (soonest first)
 */
export async function getFutureEvents() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return await db
    .select()
    .from(events)
    .where(gte(events.eventDate, today))
    .orderBy(events.eventDate);
}

/**
 * Get past events (before today) sorted by date (most recent first)
 */
export async function getPastEvents() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return await db
    .select()
    .from(events)
    .where(lt(events.eventDate, today))
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
  await syncAttendeesForEvent(eventId);

  // Return attendees from database
  return await db
    .select()
    .from(attendees)
    .where(eq(attendees.eventId, eventId))
    .orderBy(attendees.email);
}

/**
 * Check in an attendee
 */
export async function checkInAttendee(attendeeId: string) {
  await db
    .update(attendees)
    .set({
      checkedIn: true,
      checkedInAt: new Date(),
    })
    .where(eq(attendees.id, attendeeId));

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

    if (existingMember.length > 0 && existingMember[0].id !== memberId) {
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

  await db
    .update(members)
    .set(updateData)
    .where(eq(members.id, memberId));

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

  await db
    .update(members)
    .set(updateData)
    .where(eq(members.id, memberId));

  revalidatePath("/community-members-list");

  return { success: true };
}

/**
 * Delete a member
 */
export async function deleteMember(memberId: string) {
  "use server";

  await db.delete(members).where(eq(members.id, memberId));

  revalidatePath("/community-members-list");

  return { success: true };
}

/**
 * Merge two member records
 * Keeps the primary member and transfers all attendee records from secondary
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

  if (primaryMember.length === 0 || secondaryMember.length === 0) {
    throw new Error("One or both members not found");
  }

  // Transfer all attendee records from secondary to primary email
  await db
    .update(attendees)
    .set({ email: primaryMember[0].email })
    .where(eq(attendees.email, secondaryMember[0].email));

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
