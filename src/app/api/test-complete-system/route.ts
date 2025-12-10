import { NextResponse } from "next/server";
import { db } from "@/db";
import { events, attendees, members } from "@/db/schema";
import { gte, eq } from "drizzle-orm";

export async function GET() {
  try {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    // Get future events
    const futureEvents = await db
      .select()
      .from(events)
      .where(gte(events.eventDate, now))
      .limit(10);

    // Get attendee counts for each event
    const eventStats = await Promise.all(
      futureEvents.map(async (event) => {
        const eventAttendees = await db
          .select()
          .from(attendees)
          .where(eq(attendees.eventId, event.id));

        return {
          eventId: event.id,
          eventName: event.name,
          eventDate: event.eventDate,
          productId: event.woocommerceProductId,
          totalAttendees: eventAttendees.length,
          checkedIn: eventAttendees.filter((a) => a.checkedIn).length,
        };
      })
    );

    // Get total stats
    const totalEvents = await db.select().from(events);
    const totalAttendees = await db.select().from(attendees);
    const totalMembers = await db.select().from(members);

    return NextResponse.json({
      success: true,
      summary: {
        totalEvents: totalEvents.length,
        totalAttendees: totalAttendees.length,
        totalMembers: totalMembers.length,
        futureEventsCount: futureEvents.length,
      },
      futureEvents: eventStats,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
