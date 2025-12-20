import { NextResponse } from "next/server";
import postgres from "postgres";
import { env } from "@/env";

/**
 * Find ALL duplicate woocommerceProductIds using raw Postgres
 */
export async function GET() {
  const client = postgres(env.DATABASE_URL);

  try {
    const duplicates = await client`
      SELECT
        woocommerce_product_id,
        COUNT(*) as count,
        STRING_AGG(id, ', ') as event_ids,
        STRING_AGG(name, ' | ') as event_names,
        STRING_AGG(COALESCE(merged_into_event_id, 'NULL'), ' | ') as merged_states
      FROM tablecn_events
      WHERE woocommerce_product_id IS NOT NULL
      GROUP BY woocommerce_product_id
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `;

    await client.end();

    return NextResponse.json({
      success: true,
      totalDuplicates: duplicates.length,
      duplicates,
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
