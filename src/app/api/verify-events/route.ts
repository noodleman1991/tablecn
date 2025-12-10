import { NextResponse } from "next/server";
import { getOrdersForProduct } from "@/lib/woocommerce";

// Events to verify
const eventsToVerify = [
  {
    name: "Summer Party",
    date: "2025-07-12",
    productId: "13722",
  },
  {
    name: "Open Projects Night",
    date: "2025-09-16",
    productId: "15295",
  },
  {
    name: "Another World is Here But Struggling to Survive",
    date: "2025-07-10",
    productId: "14182",
  },
];

export async function GET() {
  const results = [];

  for (const event of eventsToVerify) {
    try {
      console.log(`\n🔍 Verifying: ${event.name} (${event.date})`);

      // Get ALL orders (no date filtering - simulating past event sync)
      const orders = await getOrdersForProduct(event.productId);

      const result = {
        event: event.name,
        date: event.date,
        productId: event.productId,
        woocommerceOrderCount: orders.length,
        status: "success",
      };

      console.log(`   ✅ Found ${orders.length} orders`);
      results.push(result);

    } catch (error) {
      console.error(`   ❌ Error: ${error}`);
      results.push({
        event: event.name,
        date: event.date,
        productId: event.productId,
        woocommerceOrderCount: 0,
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    success: true,
    results,
    summary: {
      totalEvents: results.length,
      totalOrders: results.reduce((sum, r) => sum + r.woocommerceOrderCount, 0),
    },
  });
}
