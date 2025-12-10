import { NextResponse } from "next/server";
import { db } from "@/db";
import { events, attendees, members } from "@/db/schema";
import { eq, gte } from "drizzle-orm";

export async function GET() {
  // Get total counts
  const allMembers = await db.select().from(members);
  const allAttendees = await db.select().from(attendees);
  const allEvents = await db.select().from(events);

  // Count active members
  const activeMembers = allMembers.filter((m) => m.isActiveMember === true);

  // Count checked-in attendees
  const checkedInAttendees = allAttendees.filter((a) => a.checkedIn === true);

  // Get unique emails from attendees
  const uniqueEmails = new Set(allAttendees.map((a) => a.email));

  // Calculate 9 months ago
  const nineMonthsAgo = new Date();
  nineMonthsAgo.setMonth(nineMonthsAgo.getMonth() - 9);

  // Count recent events (within 9 months)
  const recentEvents = allEvents.filter(
    (e) => new Date(e.eventDate) >= nineMonthsAgo
  );

  // Sample some members to see their data
  const sampleMembers = allMembers.slice(0, 5).map((m) => ({
    email: m.email,
    isActive: m.isActiveMember,
    eventsAttended: m.totalEventsAttended,
    membershipExpires: m.membershipExpiresAt,
    lastEventDate: m.lastEventDate,
  }));

  return NextResponse.json({
    summary: {
      totalMembers: allMembers.length,
      activeMembers: activeMembers.length,
      totalAttendees: allAttendees.length,
      checkedInAttendees: checkedInAttendees.length,
      uniqueAttendeeEmails: uniqueEmails.size,
      totalEvents: allEvents.length,
      recentEvents: recentEvents.length,
    },
    sampleMembers,
    nineMonthsCutoff: nineMonthsAgo.toISOString(),
  });
}
