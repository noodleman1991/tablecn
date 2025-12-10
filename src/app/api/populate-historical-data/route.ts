import { NextResponse } from "next/server";
import { db } from "@/db";
import { events, attendees, members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { recalculateMembershipForMember } from "@/lib/calculate-membership";

/**
 * Populate database with 9 months of historical events
 * Creates events, attendees (all checked in), and recalculates memberships
 *
 * This is a one-time data population script
 */
export async function POST() {
  try {
    console.log("[populate] Starting historical data population...");

    const now = new Date();
    const createdEvents = [];
    const createdAttendees = [];

    // Sample attendee names for variety
    const sampleAttendees = [
      { firstName: "Alice", lastName: "Johnson", email: "alice.johnson@example.com" },
      { firstName: "Bob", lastName: "Smith", email: "bob.smith@example.com" },
      { firstName: "Carol", lastName: "Williams", email: "carol.williams@example.com" },
      { firstName: "David", lastName: "Brown", email: "david.brown@example.com" },
      { firstName: "Emma", lastName: "Davis", email: "emma.davis@example.com" },
      { firstName: "Frank", lastName: "Miller", email: "frank.miller@example.com" },
      { firstName: "Grace", lastName: "Wilson", email: "grace.wilson@example.com" },
      { firstName: "Henry", lastName: "Moore", email: "henry.moore@example.com" },
      { firstName: "Iris", lastName: "Taylor", email: "iris.taylor@example.com" },
      { firstName: "Jack", lastName: "Anderson", email: "jack.anderson@example.com" },
      { firstName: "Kate", lastName: "Thomas", email: "kate.thomas@example.com" },
      { firstName: "Leo", lastName: "Jackson", email: "leo.jackson@example.com" },
      { firstName: "Mary", lastName: "White", email: "mary.white@example.com" },
      { firstName: "Nathan", lastName: "Harris", email: "nathan.harris@example.com" },
      { firstName: "Olivia", lastName: "Martin", email: "olivia.martin@example.com" },
      { firstName: "Paul", lastName: "Thompson", email: "paul.thompson@example.com" },
      { firstName: "Quinn", lastName: "Garcia", email: "quinn.garcia@example.com" },
      { firstName: "Rachel", lastName: "Martinez", email: "rachel.martinez@example.com" },
      { firstName: "Sam", lastName: "Robinson", email: "sam.robinson@example.com" },
      { firstName: "Tina", lastName: "Clark", email: "tina.clark@example.com" },
    ];

    // Create events for the past 9 months (2 events per month = 18 events)
    for (let monthsAgo = 9; monthsAgo >= 1; monthsAgo--) {
      // Create 2 events per month
      for (let eventNum = 1; eventNum <= 2; eventNum++) {
        const eventDate = new Date(now);
        eventDate.setMonth(eventDate.getMonth() - monthsAgo);

        // Set to a specific day (1st or 15th of the month)
        eventDate.setDate(eventNum === 1 ? 5 : 20);
        eventDate.setHours(19, 0, 0, 0); // 7 PM

        const eventName = `Community Gathering ${monthsAgo === 9 ? 'Sep' : monthsAgo === 8 ? 'Oct' : monthsAgo === 7 ? 'Nov' : monthsAgo === 6 ? 'Dec' : monthsAgo === 5 ? 'Jan' : monthsAgo === 4 ? 'Feb' : monthsAgo === 3 ? 'Mar' : monthsAgo === 2 ? 'Apr' : 'May'} ${eventNum}`;

        // Create event
        const [event] = await db.insert(events).values({
          name: eventName,
          eventDate: eventDate,
          woocommerceProductId: null, // Historical events don't need WC product ID
        }).returning();

        if (!event) {
          throw new Error(`Failed to create event: ${eventName}`);
        }

        createdEvents.push(event);
        console.log(`[populate] Created event: ${eventName} on ${eventDate.toDateString()}`);

        // Create 8-15 attendees per event (varied attendance)
        const numAttendees = Math.floor(Math.random() * 8) + 8; // 8-15 attendees
        const selectedAttendees = [...sampleAttendees]
          .sort(() => Math.random() - 0.5)
          .slice(0, numAttendees);

        for (const person of selectedAttendees) {
          const [attendee] = await db.insert(attendees).values({
            eventId: event.id,
            email: person.email,
            firstName: person.firstName,
            lastName: person.lastName,
            woocommerceOrderId: null,
            checkedIn: true, // All attendees checked in as requested
            checkedInAt: eventDate,
          }).returning();

          createdAttendees.push(attendee);

          // Create or update member record
          const existingMember = await db
            .select()
            .from(members)
            .where(eq(members.email, person.email))
            .limit(1);

          if (existingMember.length === 0) {
            await db.insert(members).values({
              email: person.email,
              firstName: person.firstName,
              lastName: person.lastName,
              isActiveMember: false,
              totalEventsAttended: 0,
            });
            console.log(`[populate] Created member: ${person.email}`);
          }
        }

        console.log(`[populate] Created ${selectedAttendees.length} attendees for ${eventName}`);
      }
    }

    console.log(`[populate] Created ${createdEvents.length} events and ${createdAttendees.length} attendees`);

    // Recalculate memberships for all members
    console.log("[populate] Recalculating memberships...");
    const allMembers = await db.select().from(members);

    const membershipResults = [];
    for (const member of allMembers) {
      try {
        const result = await recalculateMembershipForMember(member.id);
        membershipResults.push(result);
      } catch (error) {
        console.error(`[populate] Error recalculating for ${member.email}:`, error);
      }
    }

    const activeCount = membershipResults.filter(m => m.isActiveMember).length;
    const inactiveCount = membershipResults.length - activeCount;

    console.log(`[populate] Membership recalculation complete!`);
    console.log(`[populate] Active members: ${activeCount}, Inactive: ${inactiveCount}`);

    return NextResponse.json({
      success: true,
      summary: {
        eventsCreated: createdEvents.length,
        attendeesCreated: createdAttendees.length,
        membersRecalculated: membershipResults.length,
        activeMembers: activeCount,
        inactiveMembers: inactiveCount,
      },
      events: createdEvents.filter(e => e !== undefined).map(e => ({
        name: e.name,
        date: e.eventDate,
      })),
      membershipBreakdown: membershipResults.map(m => ({
        email: m.email,
        eventsAttended: m.totalEventsAttended,
        isActive: m.isActiveMember,
        expiresAt: m.membershipExpiresAt,
      })),
    });

  } catch (error) {
    console.error("[populate] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
