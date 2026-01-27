import "server-only";

import { db } from "@/db";
import { attendees, events, members } from "@/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { syncMemberToLoops, removeMemberFromLoops } from "@/lib/loops-sync";

/**
 * Recalculate membership status for a specific member
 * A member is active if they attended 3+ events in the last 9 months
 */
export async function recalculateMembershipForMember(memberId: string) {
  const member = await db
    .select()
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);

  const memberData = member[0];
  if (!memberData) {
    throw new Error(`Member not found: ${memberId}`);
  }

  // Calculate 9 months ago from today
  const nineMonthsAgo = new Date();
  nineMonthsAgo.setMonth(nineMonthsAgo.getMonth() - 9);

  // Get ALL events this member attended (checked in) - all time
  const allAttendedEvents = await db
    .select({
      eventId: attendees.eventId,
      eventDate: events.eventDate,
      eventName: events.name,
      checkedInAt: attendees.checkedInAt,
    })
    .from(attendees)
    .innerJoin(events, eq(attendees.eventId, events.id))
    .where(
      and(
        eq(attendees.email, memberData.email),
        eq(attendees.checkedIn, true),
        // NO DATE FILTER - get all events ever
      ),
    )
    .orderBy(sql`${events.eventDate} DESC`);

  // Get events in last 9 months - for recent activity check
  const recentAttendedEvents = await db
    .select({
      eventId: attendees.eventId,
      eventDate: events.eventDate,
      eventName: events.name,
    })
    .from(attendees)
    .innerJoin(events, eq(attendees.eventId, events.id))
    .where(
      and(
        eq(attendees.email, memberData.email),
        eq(attendees.checkedIn, true),
        gte(events.eventDate, nineMonthsAgo),
      ),
    );

  // Helper function to check if event is a social event (not counted toward membership)
  const isSocialEvent = (eventName: string): boolean => {
    const lowerName = eventName.toLowerCase();

    // Existing exclusions
    if (lowerName.includes("walk") || lowerName.includes("party") || lowerName.includes("drinks")) {
      return true;
    }

    // Seasonal celebrations (season + celebration together)
    const seasons = ["winter", "spring", "summer", "autumn", "fall", "solstice", "equinox"];
    const hasSeasonWord = seasons.some(season => lowerName.includes(season));
    const hasCelebration = lowerName.includes("celebration");

    if (hasSeasonWord && hasCelebration) {
      return true;
    }

    return false;
  };

  // Filter out social events before counting
  const countableAllEvents = allAttendedEvents.filter(e => !isSocialEvent(e.eventName));
  const countableRecentEvents = recentAttendedEvents.filter(e => !isSocialEvent(e.eventName));

  const totalEventsAttended = countableAllEvents.length;
  const recentEventsAttended = countableRecentEvents.length;

  // NEW RULE: Active if 3+ total events AND 1+ event in last 9 months
  const isActiveMember = totalEventsAttended >= 3 && recentEventsAttended >= 1;

  // Calculate membership expiry (9 months from last countable event attended)
  let membershipExpiresAt = null;
  let lastEventDate = null;
  let eventBasedExpiresAt = null;

  const lastCountableEvent = countableAllEvents[0];
  if (lastCountableEvent) {
    lastEventDate = new Date(lastCountableEvent.eventDate);
    eventBasedExpiresAt = new Date(lastEventDate);
    eventBasedExpiresAt.setMonth(eventBasedExpiresAt.getMonth() + 9);
  }

  // SMART EXPIRATION LOGIC:
  // For manually added members: use max(manualExpiresAt, eventBasedExpiresAt)
  // For auto-created members: use eventBasedExpiresAt
  if (memberData.manuallyAdded && memberData.manualExpiresAt) {
    // Manually added member: use the later of manual or event-based expiration
    if (eventBasedExpiresAt) {
      membershipExpiresAt = new Date(
        Math.max(
          new Date(memberData.manualExpiresAt).getTime(),
          eventBasedExpiresAt.getTime()
        )
      );
    } else {
      // No events attended yet, keep manual expiration
      membershipExpiresAt = memberData.manualExpiresAt;
    }
  } else {
    // Auto-created member or no manual expiration: use event-based
    membershipExpiresAt = eventBasedExpiresAt;
  }

  // Track if status changed for Loops sync
  const statusChanged = memberData.isActiveMember !== isActiveMember;

  // Update member record
  const [updatedMember] = await db
    .update(members)
    .set({
      isActiveMember,
      totalEventsAttended,
      membershipExpiresAt,
      lastEventDate,
    })
    .where(eq(members.id, memberId))
    .returning();

  console.log(
    `[calculate-membership] Updated ${memberData.email}: ${totalEventsAttended} total events (${recentEventsAttended} recent), active: ${isActiveMember}`,
  );

  // Sync to Loops.so if status changed
  if (updatedMember && statusChanged) {
    if (updatedMember.isActiveMember) {
      await syncMemberToLoops(updatedMember);
      console.log(`[calculate-membership] Synced ${updatedMember.email} to Loops (became active)`);
    } else {
      await removeMemberFromLoops(updatedMember.email, updatedMember.id);
      console.log(`[calculate-membership] Removed ${updatedMember.email} from Loops (became inactive)`);
    }
  }

  return {
    email: memberData.email,
    totalEventsAttended,
    isActiveMember,
    membershipExpiresAt,
    lastEventDate,
  };
}

/**
 * Recalculate membership status for a member by email
 * Creates the member if they don't exist
 */
export async function recalculateMembershipByEmail(
  email: string,
  firstName?: string | null,
  lastName?: string | null,
) {
  // Find or create member record
  let memberRecord = await db
    .select()
    .from(members)
    .where(eq(members.email, email))
    .limit(1);

  let wasCreated = false;
  let wasUpdated = false;

  if (memberRecord.length === 0) {
    // Create member if doesn't exist
    await db.insert(members).values({
      email,
      firstName: firstName || null,
      lastName: lastName || null,
      isActiveMember: false,
      totalEventsAttended: 0,
    });

    // Re-fetch
    memberRecord = await db
      .select()
      .from(members)
      .where(eq(members.email, email))
      .limit(1);

    wasCreated = true;
  } else {
    wasUpdated = true;
  }

  const currentMember = memberRecord[0];
  if (!currentMember) {
    throw new Error(`Failed to create/find member: ${email}`);
  }

  // Recalculate their membership
  const result = await recalculateMembershipForMember(currentMember.id);

  return {
    ...result,
    created: wasCreated,
    updated: wasUpdated,
  };
}

/**
 * Recalculate membership for all members who attended a specific event
 * This should be called 2 hours after an event ends
 */
export async function recalculateMembershipForEvent(eventId: string) {
  // Get all checked-in attendees for this event
  const checkedInAttendees = await db
    .select()
    .from(attendees)
    .where(and(eq(attendees.eventId, eventId), eq(attendees.checkedIn, true)));

  console.log(
    `[calculate-membership] Recalculating for ${checkedInAttendees.length} attendees`,
  );

  const results = [];

  for (const attendee of checkedInAttendees) {
    // Find or create member record
    const memberRecord = await db
      .select()
      .from(members)
      .where(eq(members.email, attendee.email))
      .limit(1);

    if (memberRecord.length === 0) {
      // Create member if doesn't exist (shouldn't happen, but just in case)
      await db.insert(members).values({
        email: attendee.email,
        firstName: attendee.firstName,
        lastName: attendee.lastName,
        isActiveMember: false,
        totalEventsAttended: 0,
      });

      // Re-fetch
      const newMember = await db
        .select()
        .from(members)
        .where(eq(members.email, attendee.email))
        .limit(1);

      const newMemberData = newMember[0];
      if (newMemberData) {
        const result = await recalculateMembershipForMember(newMemberData.id);
        results.push(result);
      }
    } else {
      const existingMember = memberRecord[0];
      if (existingMember) {
        const result = await recalculateMembershipForMember(existingMember.id);
        results.push(result);
      }
    }
  }

  return results;
}

/**
 * Find events that ended 2-3 hours ago and need membership recalculation
 */
export async function findEventsNeedingRecalculation() {
  const now = new Date();

  // 2 hours ago
  const twoHoursAgo = new Date(now);
  twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);

  // 3 hours ago
  const threeHoursAgo = new Date(now);
  threeHoursAgo.setHours(threeHoursAgo.getHours() - 3);

  // Find events that ended between 2-3 hours ago
  const eventsToProcess = await db
    .select()
    .from(events)
    .where(
      and(
        gte(events.eventDate, threeHoursAgo),
        lte(events.eventDate, twoHoursAgo),
      ),
    );

  return eventsToProcess;
}
