import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { events, attendees } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrdersForProduct } from "@/lib/woocommerce";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const productId = searchParams.get("productId");

  if (!productId) {
    return NextResponse.json(
      { error: "Missing productId parameter" },
      { status: 400 }
    );
  }

  try {
    // Find the event with this product ID
    const event = await db
      .select()
      .from(events)
      .where(eq(events.woocommerceProductId, productId))
      .limit(1);

    if (event.length === 0) {
      return NextResponse.json(
        { error: "Event not found for this product ID" },
        { status: 404 }
      );
    }

    const eventData = event[0];

    // Fetch orders from WooCommerce
    const orders = await getOrdersForProduct(productId);

    console.log(`Found ${orders.length} orders for product ${productId}`);

    // Show sample order structure
    const sampleOrder = orders[0] || null;

    // Get existing attendees
    const existingAttendees = await db
      .select()
      .from(attendees)
      .where(eq(attendees.eventId, eventData.id));

    return NextResponse.json({
      success: true,
      event: {
        id: eventData.id,
        name: eventData.name,
        eventDate: eventData.eventDate,
      },
      woocommerce: {
        totalOrders: orders.length,
        sampleOrder: sampleOrder
          ? {
              id: sampleOrder.id,
              number: sampleOrder.number,
              status: sampleOrder.status,
              billing: sampleOrder.billing,
              line_items: sampleOrder.line_items?.map((item: any) => ({
                id: item.id,
                name: item.name,
                product_id: item.product_id,
                quantity: item.quantity,
              })),
            }
          : null,
      },
      database: {
        existingAttendees: existingAttendees.length,
      },
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
