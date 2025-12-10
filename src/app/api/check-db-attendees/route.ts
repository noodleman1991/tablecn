import { NextResponse } from "next/server";
import { db } from "@/db";
import { events, attendees } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const eventIds = [
    "8zpgtnuTwrps", // Summer Party - July 12
    "uxGXRCbN0HpA", // Open Projects Night - Sep 16
    "m0cisopDj89w", // Another World - July 10
  ];

  const results = [];

  for (const eventId of eventIds) {
    const event = await db
      .select()
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);

    if (event.length === 0) {
      results.push({ eventId, error: "Event not found" });
      continue;
    }

    const attendeeList = await db
      .select()
      .from(attendees)
      .where(eq(attendees.eventId, eventId));

    results.push({
      eventId: event[0].id,
      eventName: event[0].name,
      eventDate: event[0].eventDate,
      productId: event[0].woocommerceProductId,
      attendeesInDB: attendeeList.length,
    });
  }

  return NextResponse.json({ results });
}
