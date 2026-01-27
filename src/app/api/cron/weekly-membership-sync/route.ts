import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { db } from "@/db";
import { members } from "@/db/schema";
import { recalculateMembershipForMember } from "@/lib/calculate-membership";

/**
 * Weekly Cron Job: Full Membership Sync
 *
 * Runs every Sunday at 6 AM UTC (6 AM GMT / 7 AM BST)
 * - Recalculates membership for ALL members
 * - Syncs status changes to Loops.so automatically
 *
 * This catches:
 * - Members whose expiry dates passed without attending events
 * - Any members who fell through the cracks
 * - Reconciles database state with Loops.so
 *
 * Configured in vercel.json: "0 6 * * 0"
 */
export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[weekly-membership-sync] Starting full membership sync...");

    // Get all members
    const allMembers = await db.select().from(members);
    console.log(
      `[weekly-membership-sync] Found ${allMembers.length} members to process`
    );

    const stats = {
      processed: 0,
      statusChanged: 0,
      errors: 0,
      becameActive: 0,
      becameInactive: 0,
    };

    // Process each member
    for (const member of allMembers) {
      try {
        const previousStatus = member.isActiveMember;

        // This function recalculates membership AND syncs to Loops if status changes
        const result = await recalculateMembershipForMember(member.id);

        stats.processed++;

        if (previousStatus !== result.isActiveMember) {
          stats.statusChanged++;
          if (result.isActiveMember) {
            stats.becameActive++;
          } else {
            stats.becameInactive++;
          }
        }

        // Log progress every 100 members
        if (stats.processed % 100 === 0) {
          console.log(
            `[weekly-membership-sync] Progress: ${stats.processed}/${allMembers.length}`
          );
        }
      } catch (error) {
        stats.errors++;
        console.error(
          `[weekly-membership-sync] Error processing ${member.email}:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    console.log("[weekly-membership-sync] Complete!");
    console.log(`  Processed: ${stats.processed}/${allMembers.length}`);
    console.log(`  Status changed: ${stats.statusChanged}`);
    console.log(`    - Became active: ${stats.becameActive}`);
    console.log(`    - Became inactive: ${stats.becameInactive}`);
    console.log(`  Errors: ${stats.errors}`);

    return NextResponse.json({
      success: true,
      totalMembers: allMembers.length,
      processed: stats.processed,
      statusChanged: stats.statusChanged,
      becameActive: stats.becameActive,
      becameInactive: stats.becameInactive,
      errors: stats.errors,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[weekly-membership-sync] Fatal error:", error);
    return NextResponse.json(
      {
        error: "Failed to run weekly membership sync",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
