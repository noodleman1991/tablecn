import { NextResponse } from "next/server";
import { woocommerce } from "@/lib/woocommerce";

export async function GET() {
  try {
    // Try to get ALL orders, not filtered by product
    const response = await woocommerce.get("orders", {
      per_page: 10,
      status: "completed",
    });

    const orders = response.data;

    return NextResponse.json({
      success: true,
      totalOrders: orders.length,
      sampleOrders: orders.slice(0, 3).map((order: any) => ({
        id: order.id,
        number: order.number,
        status: order.status,
        date_created: order.date_created,
        billing: {
          email: order.billing?.email,
          first_name: order.billing?.first_name,
          last_name: order.billing?.last_name,
        },
        line_items: order.line_items?.map((item: any) => ({
          name: item.name,
          product_id: item.product_id,
          quantity: item.quantity,
        })),
      })),
    });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
