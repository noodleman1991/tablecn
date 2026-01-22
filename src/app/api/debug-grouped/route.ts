import { NextResponse } from "next/server";
import { db } from "@/db";
import { attendees, events } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { groupAttendeesByOrder } from "@/lib/attendee-grouping";

/**
 * Debug API: Check how attendees are grouped for display
 * Usage: GET /api/debug-grouped?eventId=...
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  let eventId = searchParams.get("eventId");

  // If no eventId, get the most recent event
  if (!eventId) {
    const [latestEvent] = await db
      .select()
      .from(events)
      .orderBy(desc(events.eventDate))
      .limit(1);
    eventId = latestEvent?.id ?? null;
  }

  if (!eventId) {
    return NextResponse.json({ error: "No events found" }, { status: 404 });
  }

  // Get event info
  const [event] = await db
    .select()
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  // Get raw attendees
  const rawAttendees = await db
    .select()
    .from(attendees)
    .where(eq(attendees.eventId, eventId));

  // Group them
  const grouped = groupAttendeesByOrder(rawAttendees);

  // Find multi-ticket orders
  const multiTicketOrders = grouped.filter((g) => g.ticketCount > 1);

  return NextResponse.json({
    eventId,
    eventName: event?.name,
    totalAttendees: rawAttendees.length,
    totalGroups: grouped.length,
    multiTicketOrders: multiTicketOrders.length,
    multiTicketDetails: multiTicketOrders.map((order) => ({
      orderId: order.woocommerceOrderId,
      booker: `${order.bookerFirstName} ${order.bookerLastName}`,
      ticketCount: order.ticketCount,
      tickets: order.tickets.map((t) => ({
        id: t.id,
        firstName: t.firstName,
        lastName: t.lastName,
        email: t.email,
        isSameAsBooker:
          t.firstName === order.bookerFirstName &&
          t.lastName === order.bookerLastName,
      })),
    })),
  });
}
