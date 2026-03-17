import { getEventById, getAttendeesForEvent, getSyncCacheAge, getCommunityMemberEmailsForEvent } from "@/app/actions";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;

    if (!eventId) {
      return NextResponse.json(
        { error: "Event ID is required" },
        { status: 400 }
      );
    }

    // Fetch event and attendees in parallel
    const [event, attendees, cacheAge, communityEmails] = await Promise.all([
      getEventById(eventId),
      getAttendeesForEvent(eventId),
      getSyncCacheAge(eventId),
      getCommunityMemberEmailsForEvent(eventId),
    ]);

    if (!event) {
      return NextResponse.json(
        { error: "Event not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      event,
      attendees,
      cacheAge,
      communityEmails,
    });
  } catch (error) {
    console.error("[API] Error fetching event attendees:", error);
    return NextResponse.json(
      { error: "Failed to fetch event data" },
      { status: 500 }
    );
  }
}
