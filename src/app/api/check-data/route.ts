import { NextResponse } from "next/server";
import { db } from "@/db";
import { events, attendees, members } from "@/db/schema";
import { eq, sql, lt } from "drizzle-orm";

/**
 * Check actual data in database - show real counts
 */
export async function GET() {
  try {
    // Get past events with attendee counts
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const pastEventsWithCounts = await db
      .select({
        eventId: events.id,
        eventName: events.name,
        eventDate: events.eventDate,
        woocommerceProductId: events.woocommerceProductId,
        totalAttendees: sql<number>`count(${attendees.id})`,
        checkedInAttendees: sql<number>`count(case when ${attendees.checkedIn} then 1 end)`,
      })
      .from(events)
      .leftJoin(attendees, eq(events.id, attendees.eventId))
      .where(lt(events.eventDate, today))
      .groupBy(events.id, events.name, events.eventDate, events.woocommerceProductId)
      .orderBy(events.eventDate);

    // Get member counts
    const memberStats = await db
      .select({
        total: sql<number>`count(*)`,
        active: sql<number>`count(case when ${members.isActiveMember} then 1 end)`,
        inactive: sql<number>`count(case when not ${members.isActiveMember} then 1 end)`,
      })
      .from(members);

    return NextResponse.json({
      success: true,
      pastEvents: pastEventsWithCounts,
      memberStats: memberStats[0],
      summary: {
        totalPastEvents: pastEventsWithCounts.length,
        eventsWithAttendees: pastEventsWithCounts.filter(e => Number(e.totalAttendees) > 0).length,
        eventsWithoutAttendees: pastEventsWithCounts.filter(e => Number(e.totalAttendees) === 0).length,
      },
    });
  } catch (error) {
    console.error("[check-data] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
