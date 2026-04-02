import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { db } from "@/db";
import { events } from "@/db/schema";
import { and, isNotNull, isNull, sql } from "drizzle-orm";
import { syncAttendeesForEvent } from "@/lib/sync-attendees";
import {
  startBatchJob,
  getBatchJob,
  advanceBatchJob,
  completeBatchJob,
  failBatchJob,
  isJobStale,
  triggerNextChunk,
} from "@/lib/batch-processor";
import { revalidatePath } from "next/cache";

export const maxDuration = 800;

const IS_DEV = process.env.NODE_ENV === "development";
const CHUNK_SIZE = IS_DEV ? 1 : 3;
const TIME_BUDGET_MS = 720_000; // stop 80s before maxDuration

const JOB_TYPE = "event-resync";

export async function POST(request: NextRequest) {
  console.log(`[batch/resync-events] === ENTRY === ${new Date().toISOString()}`);

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    console.log("[batch/resync-events] Unauthorized request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    let job = await getBatchJob(JOB_TYPE);
    console.log(`[batch/resync-events] Current job state:`, job ? `status=${job.status} offset=${job.offset}/${job.total} stale=${isJobStale(job)}` : "null");

    // Start new job if none exists, completed, failed, or stale
    if (!job || job.status === "completed" || job.status === "failed" || isJobStale(job)) {
      const [countResult] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(events)
        .where(
          and(isNotNull(events.woocommerceProductId), isNull(events.mergedIntoEventId)),
        );
      const total = countResult?.count ?? 0;

      if (total === 0) {
        console.log("[batch/resync-events] No events to process");
        return NextResponse.json({ status: "no_events", total: 0 });
      }

      job = await startBatchJob(JOB_TYPE, total);
      console.log(`[batch/resync-events] Started new job: ${total} events`);
    } else if (job.status === "running") {
      console.log(
        `[batch/resync-events] Resuming job at offset ${job.offset}/${job.total}`,
      );
    }

    // Loop: keep processing chunks until time budget is exhausted
    let loopIteration = 0;
    while (IS_DEV || Date.now() - startTime < TIME_BUDGET_MS) {
      loopIteration++;
      console.log(`[batch/resync-events] Loop iteration ${loopIteration}, elapsed=${Date.now() - startTime}ms, offset=${job.offset}`);

      const chunk = await db
        .select({ id: events.id, name: events.name })
        .from(events)
        .where(
          and(isNotNull(events.woocommerceProductId), isNull(events.mergedIntoEventId)),
        )
        .orderBy(events.createdAt)
        .offset(job.offset)
        .limit(CHUNK_SIZE);

      if (chunk.length === 0) {
        const completed = await completeBatchJob(JOB_TYPE);
        console.log(
          `[batch/resync-events] Job complete: ${completed?.processed} processed, ${completed?.errors} errors`,
        );
        revalidatePath("/community-members-list");
        // Kick off membership sync after all events are resynced
        console.log("[batch/resync-events] Triggering membership sync...");
        try {
          const syncRes = await triggerNextChunk("/api/batch/sync-memberships");
          console.log(`[batch/resync-events] Membership sync trigger: ${syncRes.status}`);
        } catch (syncErr) {
          console.error("[batch/resync-events] Failed to trigger membership sync:", syncErr);
        }
        return NextResponse.json(completed);
      }

      let chunkErrors = 0;
      let synced = 0;

      for (const event of chunk) {
        const eventStart = Date.now();
        try {
          await syncAttendeesForEvent(event.id, true, true);
          synced++;
          console.log(`[batch/resync-events] Synced: ${event.name} (${Date.now() - eventStart}ms)`);
        } catch (error) {
          chunkErrors++;
          console.error(
            `[batch/resync-events] Error syncing ${event.name} (${Date.now() - eventStart}ms):`,
            error instanceof Error ? error.stack : error,
          );
        }
      }

      const advanced = await advanceBatchJob(JOB_TYPE, chunk.length, chunkErrors, {
        synced,
      });

      if (!advanced) {
        console.error("[batch/resync-events] advanceBatchJob returned null — Redis may be down. Failing job.");
        await failBatchJob(JOB_TYPE, "advanceBatchJob returned null — Redis read failed");
        return NextResponse.json(
          { error: "Batch state lost — Redis may be unavailable" },
          { status: 500 },
        );
      }

      job = advanced;

      console.log(
        `[batch/resync-events] Chunk done: ${chunk.length} processed, ${chunkErrors} errors, offset now ${job.offset}/${job.total}`,
      );

      // Check if we've processed everything
      if (job.offset >= job.total) {
        const completed = await completeBatchJob(JOB_TYPE);
        console.log(
          `[batch/resync-events] Job complete: ${completed?.processed} processed, ${completed?.errors} errors. Starting membership sync...`,
        );
        revalidatePath("/community-members-list");
        try {
          const syncRes = await triggerNextChunk("/api/batch/sync-memberships");
          console.log(`[batch/resync-events] Membership sync trigger: ${syncRes.status}`);
        } catch (syncErr) {
          console.error("[batch/resync-events] Failed to trigger membership sync:", syncErr);
        }
        return NextResponse.json(completed);
      }
    }

    // Time budget exhausted but more events remain — trigger continuation
    console.log(
      `[batch/resync-events] Time budget exhausted at offset ${job.offset}/${job.total}, triggering continuation`,
    );
    try {
      const contRes = await triggerNextChunk("/api/batch/resync-events");
      console.log(`[batch/resync-events] Continuation trigger: ${contRes.status}`);
    } catch (contErr) {
      console.error("[batch/resync-events] Failed to trigger continuation:", contErr);
    }
    return NextResponse.json(job);
  } catch (error) {
    console.error("[batch/resync-events] Fatal error:", error);
    await failBatchJob(
      JOB_TYPE,
      error instanceof Error ? error.message : "Unknown error",
    );
    return NextResponse.json(
      {
        error: "Batch resync failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
