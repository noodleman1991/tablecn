import { NextResponse } from "next/server";
import { db } from "@/db";
import { events, attendees, members } from "@/db/schema";
import { like } from "drizzle-orm";
import { recalculateMembershipForMember } from "@/lib/calculate-membership";

/**
 * Cleanup endpoint to remove all fake/sample data from database
 * - Deletes all attendees with @example.com emails
 * - Deletes all members with @example.com emails
 * - Deletes events created by populate-historical-data (no woocommerceProductId)
 * - Recalculates memberships for remaining real members
 */
export async function POST() {
  try {
    console.log("[cleanup] Starting fake data cleanup...");

    // Step 1: Delete all attendees with @example.com emails
    const deletedAttendees = await db
      .delete(attendees)
      .where(like(attendees.email, "%@example.com"))
      .returning();

    console.log(`[cleanup] Deleted ${deletedAttendees.length} fake attendees`);

    // Step 2: Delete all members with @example.com emails
    const deletedMembers = await db
      .delete(members)
      .where(like(members.email, "%@example.com"))
      .returning();

    console.log(`[cleanup] Deleted ${deletedMembers.length} fake members`);

    // Step 3: Delete all events without woocommerceProductId (fake historical events)
    // These are the events created by populate-historical-data script
    const deletedEvents = await db
      .delete(events)
      .where(like(events.name, "Community Gathering%"))
      .returning();

    console.log(`[cleanup] Deleted ${deletedEvents.length} fake events`);

    // Step 4: Recalculate memberships for remaining real members
    console.log("[cleanup] Recalculating memberships for real members...");
    const remainingMembers = await db.select().from(members);

    const membershipResults = [];
    for (const member of remainingMembers) {
      try {
        const result = await recalculateMembershipForMember(member.id);
        membershipResults.push(result);
      } catch (error) {
        console.error(`[cleanup] Error recalculating for ${member.email}:`, error);
      }
    }

    const activeCount = membershipResults.filter(m => m.isActiveMember).length;
    const inactiveCount = membershipResults.length - activeCount;

    console.log("[cleanup] Cleanup complete!");
    console.log(`[cleanup] Real members remaining: ${remainingMembers.length}`);
    console.log(`[cleanup] Active: ${activeCount}, Inactive: ${inactiveCount}`);

    return NextResponse.json({
      success: true,
      summary: {
        attendeesDeleted: deletedAttendees.length,
        membersDeleted: deletedMembers.length,
        eventsDeleted: deletedEvents.length,
        remainingMembers: remainingMembers.length,
        activeMembers: activeCount,
        inactiveMembers: inactiveCount,
      },
      deletedEvents: deletedEvents.map(e => ({
        name: e.name,
        date: e.eventDate,
      })),
    });

  } catch (error) {
    console.error("[cleanup] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
