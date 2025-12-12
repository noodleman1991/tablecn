import { NextResponse } from "next/server";
import { db } from "@/db";
import { events, attendees } from "@/db/schema";
import { like, sql, and, isNull } from "drizzle-orm";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") || "";

  // Find all events matching the query (excluding merged events)
  const matchingEvents = await db
    .select()
    .from(events)
    .where(
      and(
        like(events.name, `%${query}%`),
        isNull(events.mergedIntoEventId)
      )
    )
    .orderBy(sql`${events.eventDate} DESC`)
    .limit(20);

  // Get attendee counts for each event
  const results = [];
  for (const event of matchingEvents) {
    const attendeeList = await db
      .select()
      .from(attendees)
      .where(sql`${attendees.eventId} = ${event.id}`);

    results.push({
      eventId: event.id,
      eventName: event.name,
      eventDate: event.eventDate,
      productId: event.woocommerceProductId,
      attendeeCount: attendeeList.length,
    });
  }

  return NextResponse.json({ results, total: results.length });
}
