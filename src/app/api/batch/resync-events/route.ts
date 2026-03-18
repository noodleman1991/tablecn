import { NextRequest, NextResponse, after } from "next/server";
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

export const maxDuration = 300;

const CHUNK_SIZE = 3;
const JOB_TYPE = "event-resync";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let job = await getBatchJob(JOB_TYPE);

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
        return NextResponse.json({ status: "no_events", total: 0 });
      }

      job = await startBatchJob(JOB_TYPE, total);
      console.log(`[batch/resync-events] Started new job: ${total} events`);
    } else if (job.status === "running") {
      console.log(
        `[batch/resync-events] Resuming job at offset ${job.offset}/${job.total}`,
      );
    }

    // Fetch chunk of events
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
      // Kick off membership sync after all events are resynced
      after(() => triggerNextChunk("/api/batch/sync-memberships"));
      return NextResponse.json(completed);
    }

    let chunkErrors = 0;
    let synced = 0;

    for (const event of chunk) {
      try {
        await syncAttendeesForEvent(event.id, true, true);
        synced++;
        console.log(`[batch/resync-events] Synced: ${event.name}`);
      } catch (error) {
        chunkErrors++;
        console.error(
          `[batch/resync-events] Error syncing ${event.name}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    const updated = await advanceBatchJob(JOB_TYPE, chunk.length, chunkErrors, {
      synced,
    });

    console.log(
      `[batch/resync-events] Chunk done: ${chunk.length} processed, ${chunkErrors} errors, offset now ${updated?.offset}/${updated?.total}`,
    );

    // Trigger next chunk if more remain
    if (updated && updated.offset < updated.total) {
      after(() => triggerNextChunk("/api/batch/resync-events"));
      return NextResponse.json(updated);
    }

    // All done — kick off membership sync
    const completed = await completeBatchJob(JOB_TYPE);
    console.log(
      `[batch/resync-events] Job complete: ${completed?.processed} processed, ${completed?.errors} errors. Starting membership sync...`,
    );
    after(() => triggerNextChunk("/api/batch/sync-memberships"));
    return NextResponse.json(completed);
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
