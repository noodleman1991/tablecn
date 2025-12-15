import { NextResponse } from "next/server";
import { db } from "@/db";
import { events } from "@/db/schema";
import { like } from "drizzle-orm";
import { getOrdersForProductCached } from "@/lib/woocommerce";

/**
 * Debug API Route: Investigate WooCommerce Data Structure
 *
 * This route fetches WooCommerce orders for the Winter Solstice event
 * and outputs the complete order structure for analysis.
 *
 * Usage: GET /api/debug-woocommerce
 */
export async function GET() {
  try {
    // Find Winter Solstice event
    const winterSolsticeEvents = await db
      .select()
      .from(events)
      .where(like(events.name, "%Winter Solstice%"))
      .limit(1);

    if (winterSolsticeEvents.length === 0) {
      return NextResponse.json({
        error: "Winter Solstice event not found in database",
        hint: "Check events table for exact event name",
      }, { status: 404 });
    }

    const event = winterSolsticeEvents[0];
    if (!event) {
      return NextResponse.json({
        error: "Event not found after query",
      }, { status: 404 });
    }

    if (!event.woocommerceProductId) {
      return NextResponse.json({
        error: "Winter Solstice event has no WooCommerce product ID",
        event: {
          id: event.id,
          name: event.name,
          eventDate: event.eventDate,
        },
      }, { status: 400 });
    }

    console.log(`[debug-woocommerce] Fetching orders for event:`, {
      id: event.id,
      name: event.name,
      productId: event.woocommerceProductId,
    });

    // Fetch orders from WooCommerce (force refresh to get latest data)
    const orders = await getOrdersForProductCached(
      event.woocommerceProductId,
      event.eventDate,
      true  // Force refresh
    );

    console.log(`[debug-woocommerce] Fetched ${orders.length} orders`);

    // Find multi-ticket orders for detailed analysis
    const multiTicketOrders = orders.filter((order: any) => {
      const relevantLineItems = order.line_items?.filter(
        (item: any) => item.product_id?.toString() === event.woocommerceProductId
      ) || [];
      const totalQuantity = relevantLineItems.reduce(
        (sum: number, item: any) => sum + (parseInt(item.quantity) || 1),
        0
      );
      return totalQuantity > 1;
    });

    // Focus on specific test orders from CSV
    const order17576 = orders.find((o: any) => o.id === 17576);  // 2 tickets: Tania + Leo
    const order17953 = orders.find((o: any) => o.id === 17953);  // 3 tickets: Ben + Harriet + Oli

    return NextResponse.json({
      summary: {
        eventId: event.id,
        eventName: event.name,
        eventDate: event.eventDate,
        woocommerceProductId: event.woocommerceProductId,
        totalOrders: orders.length,
        multiTicketOrdersCount: multiTicketOrders.length,
      },
      investigationOrders: {
        order17576: order17576 ? {
          id: order17576.id,
          number: order17576.number,
          status: order17576.status,
          billing: order17576.billing,
          line_items: order17576.line_items,
          meta_data: order17576.meta_data,
        } : "Not found",
        order17953: order17953 ? {
          id: order17953.id,
          number: order17953.number,
          status: order17953.status,
          billing: order17953.billing,
          line_items: order17953.line_items,
          meta_data: order17953.meta_data,
        } : "Not found",
      },
      sampleMultiTicketOrders: multiTicketOrders.slice(0, 3).map((order: any) => ({
        id: order.id,
        number: order.number,
        billing: order.billing,
        line_items_count: order.line_items?.length || 0,
        line_items: order.line_items,
        meta_data_keys: order.meta_data?.map((m: any) => m.key) || [],
        meta_data: order.meta_data,
      })),
      allOrders: orders.map((order: any) => ({
        id: order.id,
        number: order.number,
        status: order.status,
        line_items_count: order.line_items?.length || 0,
      })),
    }, { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (error) {
    console.error("[debug-woocommerce] Error:", error);
    return NextResponse.json({
      error: "Failed to fetch WooCommerce data",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
