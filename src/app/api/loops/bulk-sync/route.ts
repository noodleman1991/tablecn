/**
 * Bulk Sync to Loops.so
 *
 * Manual endpoint to sync all active members to Loops.so
 * Used for:
 * - Initial population of Loops with existing members
 * - Recovery after data loss
 * - Periodic verification sync
 *
 * Protected by CRON_SECRET for security
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { env } from "@/env";
import { syncMemberToLoops, removeMemberFromLoops } from "@/lib/loops-sync";

// Note: runtime = "nodejs" removed for Next.js 16 compatibility with cacheComponents
// nodejs is the default runtime, so explicit declaration is unnecessary
export const maxDuration = 300; // 5 minutes max execution time

/**
 * POST /api/loops/bulk-sync
 *
 * Syncs all active members to Loops.so
 * Requires CRON_SECRET in Authorization header
 */
export async function POST(request: NextRequest) {
  // Verify authorization
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (token !== env.CRON_SECRET) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const startTime = Date.now();
  console.log("[Loops Bulk Sync] Starting bulk sync to Loops.so");

  try {
    // Get all members (both active and inactive)
    const allMembers = await db.query.members.findMany({
      orderBy: (members, { desc }) => [desc(members.updatedAt)],
    });

    console.log(`[Loops Bulk Sync] Found ${allMembers.length} total members`);

    const stats = {
      total: allMembers.length,
      active: 0,
      inactive: 0,
      synced: 0,
      removed: 0,
      errors: 0,
    };

    // Separate active and inactive members
    const activeMembers = allMembers.filter(m => m.isActiveMember);
    const inactiveMembers = allMembers.filter(m => !m.isActiveMember);

    stats.active = activeMembers.length;
    stats.inactive = inactiveMembers.length;

    console.log(`[Loops Bulk Sync] Active: ${stats.active}, Inactive: ${stats.inactive}`);

    // Sync active members to Loops
    for (const member of activeMembers) {
      const success = await syncMemberToLoops(member);
      if (success) {
        stats.synced++;
      } else {
        stats.errors++;
      }

      // Progress logging every 10 members
      if (stats.synced % 10 === 0 && stats.synced > 0) {
        console.log(`[Loops Bulk Sync] Progress: ${stats.synced}/${stats.active} active members synced`);
      }
    }

    // Remove inactive members from Loops
    for (const member of inactiveMembers) {
      const success = await removeMemberFromLoops(member.email, member.id);
      if (success) {
        stats.removed++;
      } else {
        stats.errors++;
      }

      // Progress logging every 10 members
      if (stats.removed % 10 === 0 && stats.removed > 0) {
        console.log(`[Loops Bulk Sync] Progress: ${stats.removed}/${stats.inactive} inactive members removed`);
      }
    }

    const duration = Date.now() - startTime;

    console.log(`[Loops Bulk Sync] Complete in ${duration}ms`);
    console.log(`[Loops Bulk Sync] Stats:`, stats);

    return NextResponse.json({
      success: true,
      stats,
      durationMs: duration,
    });

  } catch (error) {
    console.error("[Loops Bulk Sync] Fatal error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/loops/bulk-sync
 *
 * Returns status and instructions
 */
export async function GET() {
  return NextResponse.json({
    endpoint: "/api/loops/bulk-sync",
    method: "POST",
    description: "Bulk sync all active members to Loops.so",
    authentication: "Bearer token (CRON_SECRET) in Authorization header",
    usage: {
      curl: `curl -X POST https://your-domain.com/api/loops/bulk-sync -H "Authorization: Bearer YOUR_CRON_SECRET"`,
    },
  });
}
