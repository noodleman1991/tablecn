import { NextRequest, NextResponse, after } from "next/server";
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

export const maxDuration = 300;

const CHUNK_SIZE = 200;
const JOB_TYPE = "membership-sync";

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
        .from(members);
      const total = countResult?.count ?? 0;

      if (total === 0) {
        return NextResponse.json({ status: "no_members", total: 0 });
      }

      job = await startBatchJob(JOB_TYPE, total);
      console.log(`[batch/sync-memberships] Started new job: ${total} members`);
    } else if (job.status === "running") {
      console.log(
        `[batch/sync-memberships] Resuming job at offset ${job.offset}/${job.total}`,
      );
    }

    // Fetch chunk of members
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
          error instanceof Error ? error.message : error,
        );
      }
    }

    const updated = await advanceBatchJob(JOB_TYPE, chunk.length, chunkErrors, {
      statusChanged,
    });

    console.log(
      `[batch/sync-memberships] Chunk done: ${chunk.length} processed, ${chunkErrors} errors, offset now ${updated?.offset}/${updated?.total}`,
    );

    // Trigger next chunk if more remain
    if (updated && updated.offset < updated.total) {
      after(() => triggerNextChunk("/api/batch/sync-memberships"));
      return NextResponse.json(updated);
    }

    // All done
    const completed = await completeBatchJob(JOB_TYPE);
    console.log(
      `[batch/sync-memberships] Job complete: ${completed?.processed} processed, ${completed?.errors} errors`,
    );
    return NextResponse.json(completed);
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
