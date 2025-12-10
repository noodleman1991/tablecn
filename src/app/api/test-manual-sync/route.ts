import { NextRequest, NextResponse } from "next/server";
import { syncAttendeesForEvent } from "@/lib/sync-attendees";
import { db } from "@/db";
import { attendees } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const eventId = searchParams.get("eventId");

  if (!eventId) {
    return NextResponse.json(
      { error: "Missing eventId parameter" },
      { status: 400 }
    );
  }

  try {
    // Run the sync
    const result = await syncAttendeesForEvent(eventId);

    // Get the synced attendees
    const syncedAttendees = await db
      .select()
      .from(attendees)
      .where(eq(attendees.eventId, eventId));

    return NextResponse.json({
      success: true,
      syncResult: result,
      totalAttendees: syncedAttendees.length,
      sampleAttendees: syncedAttendees.slice(0, 3).map((a) => ({
        id: a.id,
        email: a.email,
        firstName: a.firstName,
        lastName: a.lastName,
        checkedIn: a.checkedIn,
        woocommerceOrderId: a.woocommerceOrderId,
      })),
    });
  } catch (error) {
    console.error("Error:", error);
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
