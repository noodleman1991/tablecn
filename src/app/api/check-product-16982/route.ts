import { NextResponse } from "next/server";
import postgres from "postgres";
import { env } from "@/env";

/**
 * Check specific product ID 16982
 */
export async function GET() {
  const client = postgres(env.DATABASE_URL);

  try {
    const result = await client`
      SELECT id, name, woocommerce_product_id, merged_into_event_id, event_date
      FROM tablecn_events
      WHERE woocommerce_product_id = '16982'
      ORDER BY created_at
    `;

    await client.end();

    return NextResponse.json({
      success: true,
      count: result.length,
      events: result,
    });
  } catch (error: any) {
    await client.end();
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
