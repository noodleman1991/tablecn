import { NextResponse } from "next/server";
import { db } from "@/db";
import { attendees, events } from "@/db/schema";
import { eq, gte, count } from "drizzle-orm";
import { getCacheAge } from "@/lib/cache-utils";

/**
 * Diagnostic endpoint to investigate sync/cache/database state
 * Returns comprehensive information about all future events and their attendees
 *
 * Usage: GET /api/diagnose-sync-issue
 */
export async function GET() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get all future events (today and onwards)
    const futureEvents = await db
      .select()
      .from(events)
      .where(gte(events.eventDate, today))
      .orderBy(events.eventDate);

    // For each event, get attendee count and cache info
    const diagnosticData = await Promise.all(
      futureEvents.map(async (event) => {
        // Count attendees in database
        const attendeeCount = await db
          .select({ count: count() })
          .from(attendees)
          .where(eq(attendees.eventId, event.id));

        // Get sample attendees
        const sampleAttendees = await db
          .select()
          .from(attendees)
          .where(eq(attendees.eventId, event.id))
          .limit(5);

        // Check cache age
        const cacheKey = `sync:event:${event.id}`;
        const cacheAgeSeconds = await getCacheAge(cacheKey);

        return {
          eventId: event.id,
          eventName: event.name,
          eventDate: event.eventDate,
          woocommerceProductId: event.woocommerceProductId,
          mergedIntoEventId: event.mergedIntoEventId,
          createdAt: event.createdAt,
          updatedAt: event.updatedAt,
          attendeeCount: attendeeCount[0]?.count || 0,
          sampleAttendees: sampleAttendees.map((a) => ({
            id: a.id,
            email: a.email,
            firstName: a.firstName,
            lastName: a.lastName,
            woocommerceOrderId: a.woocommerceOrderId,
            checkedIn: a.checkedIn,
            manuallyAdded: a.manuallyAdded,
            locallyModified: a.locallyModified,
          })),
          cache: {
            exists: cacheAgeSeconds !== null,
            ageSeconds: cacheAgeSeconds,
            ageMinutes: cacheAgeSeconds ? Math.floor(cacheAgeSeconds / 60) : null,
            ageHours: cacheAgeSeconds ? (cacheAgeSeconds / 3600).toFixed(2) : null,
          },
        };
      })
    );

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      totalFutureEvents: futureEvents.length,
      events: diagnosticData,
    });
  } catch (error) {
    console.error("Diagnostic error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
