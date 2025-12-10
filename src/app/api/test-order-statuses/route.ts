import { NextResponse } from "next/server";
import { woocommerce } from "@/lib/woocommerce";

export async function GET() {
  try {
    const statuses = ["completed", "processing", "on-hold", "pending", "cancelled", "refunded", "failed"];
    const results: any = {};

    for (const status of statuses) {
      try {
        const response = await woocommerce.get("orders", {
          per_page: 5,
          status,
        });
        results[status] = {
          count: response.data.length,
          sampleOrders: response.data.slice(0, 2).map((order: any) => ({
            id: order.id,
            number: order.number,
            date_created: order.date_created,
            status: order.status,
            line_items: order.line_items?.map((item: any) => ({
              product_id: item.product_id,
              name: item.name,
            })),
          })),
        };
      } catch (error) {
        results[status] = { error: "Failed to fetch" };
      }
    }

    return NextResponse.json({
      success: true,
      ordersByStatus: results,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
