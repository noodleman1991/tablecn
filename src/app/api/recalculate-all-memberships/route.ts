import { NextResponse } from "next/server";
import {
  getBatchJob,
  isJobStale,
  triggerNextChunk,
} from "@/lib/batch-processor";

export const maxDuration = 60;

export async function POST() {
  try {
    const existing = await getBatchJob("membership-sync");
    if (existing?.status === "running" && !isJobStale(existing)) {
      return NextResponse.json({ alreadyRunning: true, ...existing });
    }

    triggerNextChunk("/api/batch/sync-memberships");

    return NextResponse.json({ status: "started" });
  } catch (error) {
    console.error("[recalc-all] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
