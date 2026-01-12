import { NextResponse } from "next/server";
import { db } from "@/db";
import { attendees } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Debug API Route: Check database records for a specific order
 * Usage: GET /api/check-order?orderId=18382
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("orderId");

  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const results = await db
    .select({
      id: attendees.id,
      firstName: attendees.firstName,
      lastName: attendees.lastName,
      email: attendees.email,
      bookerFirstName: attendees.bookerFirstName,
      bookerLastName: attendees.bookerLastName,
      bookerEmail: attendees.bookerEmail,
      ticketId: attendees.ticketId,
      orderId: attendees.woocommerceOrderId,
      eventId: attendees.eventId,
    })
    .from(attendees)
    .where(eq(attendees.woocommerceOrderId, orderId));

  return NextResponse.json({
    orderId,
    attendeesCount: results.length,
    attendees: results.map((a) => ({
      ...a,
      isSameAsBooker:
        a.firstName === a.bookerFirstName && a.lastName === a.bookerLastName,
    })),
  });
}
