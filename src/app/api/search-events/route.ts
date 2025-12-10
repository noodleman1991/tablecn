import { NextResponse } from "next/server";
import { db } from "@/db";
import { events, attendees } from "@/db/schema";
import { like, sql } from "drizzle-orm";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") || "";

  // Find all events matching the query
  const matchingEvents = await db
    .select()
    .from(events)
    .where(like(events.name, `%${query}%`))
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
