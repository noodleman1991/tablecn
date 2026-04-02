import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { db } from "@/db";
import { members } from "@/db/schema";
import { sql } from "drizzle-orm";
import { recalculateMembershipForMember } from "@/lib/calculate-membership";
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
const CHUNK_SIZE = 200;
const TIME_BUDGET_MS = 720_000; // stop 80s before maxDuration

const JOB_TYPE = "membership-sync";

export async function POST(request: NextRequest) {
  console.log(`[batch/sync-memberships] === ENTRY === ${new Date().toISOString()}`);

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    console.log("[batch/sync-memberships] Unauthorized request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    let job = await getBatchJob(JOB_TYPE);
    console.log(`[batch/sync-memberships] Current job state:`, job ? `status=${job.status} offset=${job.offset}/${job.total} stale=${isJobStale(job)}` : "null");

    // Start new job if none exists, completed, failed, or stale
    if (!job || job.status === "completed" || job.status === "failed" || isJobStale(job)) {
      const [countResult] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(members);
      const total = countResult?.count ?? 0;

      if (total === 0) {
        console.log("[batch/sync-memberships] No members to process");
        return NextResponse.json({ status: "no_members", total: 0 });
      }

      job = await startBatchJob(JOB_TYPE, total);
      console.log(`[batch/sync-memberships] Started new job: ${total} members`);
    } else if (job.status === "running") {
      console.log(
        `[batch/sync-memberships] Resuming job at offset ${job.offset}/${job.total}`,
      );
    }

    // Loop: keep processing chunks until time budget is exhausted
    let loopIteration = 0;
    while (IS_DEV || Date.now() - startTime < TIME_BUDGET_MS) {
      loopIteration++;
      console.log(`[batch/sync-memberships] Loop iteration ${loopIteration}, elapsed=${Date.now() - startTime}ms, offset=${job.offset}`);

      const chunk = await db
        .select()
        .from(members)
        .orderBy(members.createdAt)
        .offset(job.offset)
        .limit(CHUNK_SIZE);

      if (chunk.length === 0) {
        const completed = await completeBatchJob(JOB_TYPE);
        console.log(
          `[batch/sync-memberships] Job complete: ${completed?.processed} processed, ${completed?.errors} errors`,
        );
        revalidatePath("/community-members-list");
        revalidatePath("/");
        console.log("[batch/sync-memberships] Triggering Loops bulk sync...");
        try {
          const loopsRes = await triggerNextChunk("/api/loops/bulk-sync");
          console.log(`[batch/sync-memberships] Loops bulk sync trigger: ${loopsRes.status}`);
        } catch (loopsErr) {
          console.error("[batch/sync-memberships] Failed to trigger Loops bulk sync:", loopsErr);
        }
        return NextResponse.json(completed);
      }

      let chunkErrors = 0;
      let statusChanged = 0;

      for (const member of chunk) {
        try {
          const previousStatus = member.isActiveMember;
          const result = await recalculateMembershipForMember(member.id);

          if (previousStatus !== result.isActiveMember) {
            statusChanged++;
          }
        } catch (error) {
          chunkErrors++;
          console.error(
            `[batch/sync-memberships] Error processing ${member.email}:`,
            error instanceof Error ? error.stack : error,
          );
        }
      }

      const advanced = await advanceBatchJob(JOB_TYPE, chunk.length, chunkErrors, {
        statusChanged,
      });

      if (!advanced) {
        console.error("[batch/sync-memberships] advanceBatchJob returned null — Redis may be down. Failing job.");
        await failBatchJob(JOB_TYPE, "advanceBatchJob returned null — Redis read failed");
        return NextResponse.json(
          { error: "Batch state lost — Redis may be unavailable" },
          { status: 500 },
        );
      }

      job = advanced;

      console.log(
        `[batch/sync-memberships] Chunk done: ${chunk.length} processed, ${chunkErrors} errors, offset now ${job.offset}/${job.total}`,
      );

      // Check if we've processed everything
      if (job.offset >= job.total) {
        const completed = await completeBatchJob(JOB_TYPE);
        console.log(
          `[batch/sync-memberships] Job complete: ${completed?.processed} processed, ${completed?.errors} errors`,
        );
        revalidatePath("/community-members-list");
        revalidatePath("/");
        console.log("[batch/sync-memberships] Triggering Loops bulk sync...");
        try {
          const loopsRes = await triggerNextChunk("/api/loops/bulk-sync");
          console.log(`[batch/sync-memberships] Loops bulk sync trigger: ${loopsRes.status}`);
        } catch (loopsErr) {
          console.error("[batch/sync-memberships] Failed to trigger Loops bulk sync:", loopsErr);
        }
        return NextResponse.json(completed);
      }
    }

    // Time budget exhausted but more members remain — trigger continuation
    console.log(
      `[batch/sync-memberships] Time budget exhausted at offset ${job.offset}/${job.total}, triggering continuation`,
    );
    try {
      const contRes = await triggerNextChunk("/api/batch/sync-memberships");
      console.log(`[batch/sync-memberships] Continuation trigger: ${contRes.status}`);
    } catch (contErr) {
      console.error("[batch/sync-memberships] Failed to trigger continuation:", contErr);
    }
    return NextResponse.json(job);
  } catch (error) {
    console.error("[batch/sync-memberships] Fatal error:", error);
    await failBatchJob(
      JOB_TYPE,
      error instanceof Error ? error.message : "Unknown error",
    );
    return NextResponse.json(
      {
        error: "Batch sync failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
