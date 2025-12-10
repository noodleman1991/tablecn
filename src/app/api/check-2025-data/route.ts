import { db } from "@/db";
import { events, attendees } from "@/db/schema";
import { sql, gte } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const year2025Start = new Date('2025-01-01');

    // Count 2025 attendees
    const attendee2025Count = await db
      .select({ count: sql<number>`count(*)` })
      .from(attendees)
      .where(gte(attendees.checkedInAt, year2025Start));

    // Count 2025 events
    const event2025Count = await db
      .select({ count: sql<number>`count(*)` })
      .from(events)
      .where(gte(events.eventDate, year2025Start));

    // Get latest event date
    const latestEvent = await db
      .select({
        name: events.name,
        eventDate: events.eventDate
      })
      .from(events)
      .orderBy(sql`${events.eventDate} DESC`)
      .limit(1);

    // Get latest check-in
    const latestCheckin = await db
      .select({
        email: attendees.email,
        checkedInAt: attendees.checkedInAt,
        eventId: attendees.eventId,
      })
      .from(attendees)
      .where(sql`${attendees.checkedInAt} IS NOT NULL`)
      .orderBy(sql`${attendees.checkedInAt} DESC`)
      .limit(1);

    // Get 5 most recent attendees with event info
    const recentAttendees = await db
      .select({
        email: attendees.email,
        checkedInAt: attendees.checkedInAt,
        eventName: events.name,
        eventDate: events.eventDate,
      })
      .from(attendees)
      .leftJoin(events, sql`${attendees.eventId} = ${events.id}`)
      .where(sql`${attendees.checkedInAt} IS NOT NULL`)
      .orderBy(sql`${attendees.checkedInAt} DESC`)
      .limit(5);

    return NextResponse.json({
      year2025: {
        attendees: attendee2025Count[0]?.count || 0,
        events: event2025Count[0]?.count || 0,
      },
      latestEvent: latestEvent[0] || null,
      latestCheckin: latestCheckin[0] || null,
      recentAttendees: recentAttendees,
    });
  } catch (error) {
    console.error("[api/check-2025-data] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to check 2025 data",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
