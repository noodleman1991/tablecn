import { NextResponse } from "next/server";
import { db } from "@/db";
import { attendees, events } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";

/**
 * One-time cleanup endpoint to fix future events with incorrectly checked-in attendees
 * DELETE THIS FILE AFTER RUNNING
 */
export async function POST() {
  try {
    console.log("[cleanup] Starting future event check-in cleanup...");

    // Get all future events (Dec 5, 2025 and later)
    const futureEvents = await db
      .select()
      .from(events)
      .where(gte(events.eventDate, new Date("2025-12-05")));

    console.log(`[cleanup] Found ${futureEvents.length} future events`);

    let totalCleaned = 0;

    // Clean up attendees for each future event
    for (const event of futureEvents) {
      const result = await db
        .update(attendees)
        .set({
          checkedIn: false,
          checkedInAt: null,
        })
        .where(
          and(
            eq(attendees.eventId, event.id),
            eq(attendees.checkedIn, true),
            sql`${attendees.woocommerceOrderId} IS NOT NULL`
          )
        );

      totalCleaned++;
    }

    console.log(`[cleanup] Cleaned ${totalCleaned} events`);

    // Verify the cleanup
    const verificationResults = [];
    for (const event of futureEvents) {
      const allAttendees = await db
        .select()
        .from(attendees)
        .where(eq(attendees.eventId, event.id));

      const checkedInCount = allAttendees.filter((a) => a.checkedIn).length;
      const uncheckedCount = allAttendees.filter((a) => !a.checkedIn).length;

      verificationResults.push({
        name: event.name,
        eventDate: event.eventDate,
        totalAttendees: allAttendees.length,
        checkedInCount,
        uncheckedCount,
      });
    }

    return NextResponse.json({
      success: true,
      message: "Future event attendees cleaned up successfully",
      totalEventsProcessed: totalCleaned,
      verification: verificationResults,
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

export const maxDuration = 60; // 1 minute
