import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { findDuplicateEvents } from "@/lib/merge-events";

/**
 * Debug endpoint to inspect duplicate events without actually merging them
 * Useful for troubleshooting and understanding what will be merged
 *
 * Usage:
 * curl -H "Authorization: Bearer $CRON_SECRET" \
 *   http://localhost:3000/api/debug-merge | jq
 */
export async function GET(request: NextRequest) {
  // Verify authorization
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[debug-merge] Fetching duplicate events for inspection...");
    const startTime = Date.now();

    const duplicateGroups = await findDuplicateEvents();

    const executionTimeMs = Date.now() - startTime;

    console.log(`[debug-merge] Found ${duplicateGroups.length} duplicate groups in ${executionTimeMs}ms`);

    return NextResponse.json({
      success: true,
      groupsFound: duplicateGroups.length,
      executionTimeMs,
      groups: duplicateGroups.map(g => ({
        date: g.date,
        sharedPrefix: g.sharedPrefix,
        eventCount: g.events.length,
        totalAttendees: g.events.reduce((sum, e) => sum + e.attendeeCount, 0),
        events: g.events.map(e => ({
          id: e.id,
          name: e.name,
          productId: e.woocommerceProductId,
          attendeeCount: e.attendeeCount,
        })),
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[debug-merge] Error:", error);
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
