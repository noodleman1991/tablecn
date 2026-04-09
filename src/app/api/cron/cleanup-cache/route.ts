import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { cleanupExpiredCache } from "@/lib/cache-utils";

/**
 * Cron job to clean up expired cache entries
 * Runs every 6 hours
 */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[cron] Starting cache cleanup...");
    const deletedCount = await cleanupExpiredCache();
    console.log(`[cron] Cache cleanup complete. Deleted ${deletedCount} entries.`);

    return NextResponse.json({
      success: true,
      deletedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[cron] Cache cleanup failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
