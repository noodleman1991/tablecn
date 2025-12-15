import { NextResponse } from "next/server";
import { db } from "@/db";
import { attendees, events } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Cleanup API: Delete all attendees for a specific event
 * Use this before re-syncing to remove old duplicates
 *
 * Usage:
 * POST /api/cleanup-duplicates
 * Body: { "eventId": "event_id_here" }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json() as { eventId?: string };
    const eventId = body.eventId;

    if (!eventId) {
      return NextResponse.json(
        { error: "eventId is required" },
        { status: 400 }
      );
    }

    // Verify event exists
    const [event] = await db
      .select()
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);

    if (!event) {
      return NextResponse.json(
        { error: "Event not found" },
        { status: 404 }
      );
    }

    // Delete all attendees for this event
    await db
      .delete(attendees)
      .where(eq(attendees.eventId, event.id));

    return NextResponse.json({
      success: true,
      eventId: event.id,
      eventName: event.name,
      message: `Deleted all attendees for ${event.name}. Ready to re-sync.`,
    });
  } catch (error) {
    console.error("Cleanup error:", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
