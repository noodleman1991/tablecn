import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import {
  findEventsNeedingRecalculation,
  recalculateMembershipForEvent,
} from "@/lib/calculate-membership";

/**
 * Cron job to recalculate memberships after events end
 * Runs hourly and checks for events that ended 2-3 hours ago
 *
 * Vercel Cron: https://vercel.com/docs/cron-jobs
 * Configured in vercel.json to run every hour
 */
export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log(
      "[recalculate-memberships] Starting membership recalculation...",
    );

    // Find events that ended 2-3 hours ago
    const eventsToProcess = await findEventsNeedingRecalculation();
    console.log(
      `[recalculate-memberships] Found ${eventsToProcess.length} events to process`,
    );

    if (eventsToProcess.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No events to process",
        eventsProcessed: 0,
      });
    }

    const results = [];

    // Process each event
    for (const event of eventsToProcess) {
      console.log(
        `[recalculate-memberships] Processing event: ${event.name} (${event.eventDate})`,
      );

      const memberResults = await recalculateMembershipForEvent(event.id);

      results.push({
        eventId: event.id,
        eventName: event.name,
        eventDate: event.eventDate,
        membersUpdated: memberResults.length,
      });

      console.log(
        `[recalculate-memberships] Completed ${event.name}: ${memberResults.length} members updated`,
      );
    }

    return NextResponse.json({
      success: true,
      eventsProcessed: eventsToProcess.length,
      results,
    });
  } catch (error) {
    console.error("[recalculate-memberships] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to recalculate memberships",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
