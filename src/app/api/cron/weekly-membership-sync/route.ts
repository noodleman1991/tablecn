import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import {
  getBatchJob,
  isJobStale,
  triggerNextChunk,
} from "@/lib/batch-processor";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[weekly-membership-sync] Triggering batch membership sync...");

    const existing = await getBatchJob("membership-sync");
    if (existing?.status === "running" && !isJobStale(existing)) {
      triggerNextChunk("/api/batch/sync-memberships");
      console.log("[weekly-membership-sync] Resumed existing batch job");
      return NextResponse.json({ resuming: true, ...existing });
    }

    triggerNextChunk("/api/batch/sync-memberships");
    console.log("[weekly-membership-sync] Started new batch job");
    return NextResponse.json({
      status: "started",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[weekly-membership-sync] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to trigger membership sync",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
