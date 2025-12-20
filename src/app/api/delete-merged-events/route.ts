import { NextResponse } from "next/server";
import postgres from "postgres";
import { env } from "@/env";

/**
 * Delete all merged events (where merged_into_event_id IS NOT NULL)
 * This is necessary before adding unique constraint on woocommerceProductId
 */
export async function POST() {
  const client = postgres(env.DATABASE_URL);

  try {
    // First, count how many will be deleted
    const countResult = await client`
      SELECT COUNT(*) as count
      FROM tablecn_events
      WHERE merged_into_event_id IS NOT NULL
    `;

    const count = countResult[0]?.count || 0;

    // Delete all merged events
    const deleteResult = await client`
      DELETE FROM tablecn_events
      WHERE merged_into_event_id IS NOT NULL
    `;

    await client.end();

    return NextResponse.json({
      success: true,
      message: `Deleted ${count} merged events`,
      deletedCount: count,
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
