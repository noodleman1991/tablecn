/**
 * Bulk Sync to Loops.so
 *
 * Syncs all active members to Loops.so and removes inactive members.
 * Uses time budget + continuation pattern for reliability on Vercel.
 *
 * Protected by CRON_SECRET for security.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { members } from "@/db/schema";
import { env } from "@/env";
import { syncMemberToLoops, removeMemberFromLoops } from "@/lib/loops-sync";
import {
  startBatchJob,
  getBatchJob,
  advanceBatchJob,
  completeBatchJob,
  failBatchJob,
  isJobStale,
  triggerNextChunk,
} from "@/lib/batch-processor";

export const maxDuration = 800;

const CHUNK_SIZE = 50;
const TIME_BUDGET_MS = 720_000; // stop 80s before maxDuration
const IS_DEV = process.env.NODE_ENV === "development";

const JOB_TYPE = "loops-sync";

/**
 * POST /api/loops/bulk-sync
 *
 * Syncs all active members to Loops.so, removes inactive members.
 * Requires CRON_SECRET in Authorization header.
 */
export async function POST(request: NextRequest) {
  console.log(`[loops/bulk-sync] === ENTRY === ${new Date().toISOString()}`);

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (token !== env.CRON_SECRET) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const startTime = Date.now();

  try {
    let job = await getBatchJob(JOB_TYPE);
    console.log(`[loops/bulk-sync] Current job state:`, job ? `status=${job.status} offset=${job.offset}/${job.total} stale=${isJobStale(job)}` : "null");

    // Start new job if none exists, completed, failed, or stale
    if (!job || job.status === "completed" || job.status === "failed" || isJobStale(job)) {
      const allMembers = await db.query.members.findMany({
        orderBy: (members, { desc }) => [desc(members.isActiveMember), desc(members.updatedAt)],
      });
      const total = allMembers.length;

      if (total === 0) {
        console.log("[loops/bulk-sync] No members to process");
        return NextResponse.json({ status: "no_members", total: 0 });
      }

      job = await startBatchJob(JOB_TYPE, total);
      console.log(`[loops/bulk-sync] Started new job: ${total} members`);
    } else if (job.status === "running") {
      console.log(
        `[loops/bulk-sync] Resuming job at offset ${job.offset}/${job.total}`,
      );
    }

    // Loop: keep processing chunks until time budget is exhausted
    let loopIteration = 0;
    while (IS_DEV || Date.now() - startTime < TIME_BUDGET_MS) {
      loopIteration++;
      console.log(`[loops/bulk-sync] Loop iteration ${loopIteration}, elapsed=${Date.now() - startTime}ms, offset=${job.offset}`);

      // Fetch members ordered consistently (active first, then by updatedAt desc)
      const chunk = await db.query.members.findMany({
        orderBy: (members, { desc }) => [desc(members.isActiveMember), desc(members.updatedAt)],
        offset: job.offset,
        limit: CHUNK_SIZE,
      });

      if (chunk.length === 0) {
        const completed = await completeBatchJob(JOB_TYPE);
        console.log(
          `[loops/bulk-sync] Job complete: ${completed?.processed} processed, ${completed?.errors} errors`,
        );
        return NextResponse.json({
          success: true,
          stats: completed?.stats,
          processed: completed?.processed,
          errors: completed?.errors,
        });
      }

      let chunkErrors = 0;
      let synced = 0;
      let removed = 0;

      for (const member of chunk) {
        try {
          if (member.isActiveMember) {
            const success = await syncMemberToLoops(member);
            if (success) synced++;
            else chunkErrors++;
          } else {
            const success = await removeMemberFromLoops(member.email, member.id);
            if (success) removed++;
            else chunkErrors++;
          }
        } catch (error) {
          chunkErrors++;
          console.error(
            `[loops/bulk-sync] Error processing ${member.email}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }

      const advanced = await advanceBatchJob(JOB_TYPE, chunk.length, chunkErrors, {
        synced,
        removed,
      });

      if (!advanced) {
        console.error("[loops/bulk-sync] advanceBatchJob returned null — Redis may be down. Failing job.");
        await failBatchJob(JOB_TYPE, "advanceBatchJob returned null — Redis read failed");
        return NextResponse.json(
          { error: "Batch state lost — Redis may be unavailable" },
          { status: 500 },
        );
      }

      job = advanced;

      console.log(
        `[loops/bulk-sync] Chunk done: ${chunk.length} processed (${synced} synced, ${removed} removed, ${chunkErrors} errors), offset now ${job.offset}/${job.total}`,
      );

      // Check if we've processed everything
      if (job.offset >= job.total) {
        const completed = await completeBatchJob(JOB_TYPE);
        console.log(
          `[loops/bulk-sync] Job complete: ${completed?.processed} processed, ${completed?.errors} errors`,
        );
        return NextResponse.json({
          success: true,
          stats: completed?.stats,
          processed: completed?.processed,
          errors: completed?.errors,
        });
      }
    }

    // Time budget exhausted but more members remain — trigger continuation
    console.log(
      `[loops/bulk-sync] Time budget exhausted at offset ${job.offset}/${job.total}, triggering continuation`,
    );
    try {
      const contRes = await triggerNextChunk("/api/loops/bulk-sync");
      console.log(`[loops/bulk-sync] Continuation trigger: ${contRes.status}`);
    } catch (contErr) {
      console.error("[loops/bulk-sync] Failed to trigger continuation:", contErr);
    }
    return NextResponse.json(job);
  } catch (error) {
    console.error("[loops/bulk-sync] Fatal error:", error);
    await failBatchJob(
      JOB_TYPE,
      error instanceof Error ? error.message : "Unknown error",
    );
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
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
