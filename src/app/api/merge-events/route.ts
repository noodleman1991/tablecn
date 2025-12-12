import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { mergeDuplicateEvents } from "@/lib/merge-events";

/**
 * Manual trigger endpoint for event merging
 * Useful for testing and ad-hoc merges
 *
 * Usage:
 * curl -X POST http://localhost:3000/api/merge-events \
 *   -H "Authorization: Bearer $CRON_SECRET"
 */
export async function POST(request: NextRequest) {
  // Verify authorization
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[merge-events-api] Starting manual merge...");
    const startTime = Date.now();

    const result = await mergeDuplicateEvents();

    const executionTimeMs = Date.now() - startTime;

    console.log("[merge-events-api] Manual merge completed");

    return NextResponse.json({
      success: true,
      groupsFound: result.groupsFound,
      groupsMerged: result.groupsMerged,
      groupsFailed: result.groupsFailed,
      totalEventsMerged: result.totalEventsMerged,
      totalAttendeesAffected: result.totalAttendeesAffected,
      executionTimeMs,
      details: result.details,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[merge-events-api] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to merge events",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
