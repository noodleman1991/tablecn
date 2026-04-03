import { redis } from "./redis";
import { env } from "@/env";

export interface BatchJobState {
  jobId: string;
  type: string;
  status: "running" | "completed" | "failed";
  total: number;
  processed: number;
  offset: number;
  errors: number;
  startedAt: string;
  lastHeartbeat: string;
  stats: Record<string, number>;
  error?: string;
}

const BATCH_KEY_PREFIX = "batch:";
const BATCH_TTL_SECONDS = 86400; // 24 hours — full resync chain can take 20+ hours
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes — increased to handle Vercel cold starts and retries

function batchKey(type: string): string {
  return `${BATCH_KEY_PREFIX}${type}`;
}

export async function startBatchJob(
  type: string,
  total: number,
  startOffset: number = 0,
): Promise<BatchJobState> {
  if (!redis) {
    throw new Error("Redis is not configured — cannot run batch jobs");
  }

  const now = new Date().toISOString();
  const state: BatchJobState = {
    jobId: `${type}-${Date.now()}`,
    type,
    status: "running",
    total,
    processed: startOffset,
    offset: startOffset,
    errors: 0,
    startedAt: now,
    lastHeartbeat: now,
    stats: {},
  };

  await redis.set(batchKey(type), JSON.stringify(state), {
    ex: BATCH_TTL_SECONDS,
  });

  return state;
}

export async function getBatchJob(
  type: string,
): Promise<BatchJobState | null> {
  if (!redis) return null;

  const raw = await redis.get(batchKey(type));
  if (!raw) return null;

  if (typeof raw === "string") {
    return JSON.parse(raw) as BatchJobState;
  }
  return raw as BatchJobState;
}

export async function advanceBatchJob(
  type: string,
  chunkProcessed: number,
  chunkErrors: number,
  extraStats?: Record<string, number>,
): Promise<BatchJobState | null> {
  if (!redis) return null;

  const job = await getBatchJob(type);
  if (!job) return null;

  job.offset += chunkProcessed;
  job.processed += chunkProcessed;
  job.errors += chunkErrors;
  job.lastHeartbeat = new Date().toISOString();

  if (extraStats) {
    for (const [key, value] of Object.entries(extraStats)) {
      job.stats[key] = (job.stats[key] ?? 0) + value;
    }
  }

  await redis.set(batchKey(type), JSON.stringify(job), {
    ex: BATCH_TTL_SECONDS,
  });

  return job;
}

export async function completeBatchJob(
  type: string,
): Promise<BatchJobState | null> {
  if (!redis) return null;

  const job = await getBatchJob(type);
  if (!job) return null;

  job.status = "completed";
  job.lastHeartbeat = new Date().toISOString();

  await redis.set(batchKey(type), JSON.stringify(job), {
    ex: BATCH_TTL_SECONDS,
  });

  return job;
}

export async function failBatchJob(
  type: string,
  error: string,
): Promise<BatchJobState | null> {
  if (!redis) return null;

  const job = await getBatchJob(type);
  if (!job) return null;

  job.status = "failed";
  job.error = error;
  job.lastHeartbeat = new Date().toISOString();

  await redis.set(batchKey(type), JSON.stringify(job), {
    ex: BATCH_TTL_SECONDS,
  });

  return job;
}

export function isJobStale(job: BatchJobState): boolean {
  const lastHeartbeat = new Date(job.lastHeartbeat).getTime();
  return Date.now() - lastHeartbeat > STALE_THRESHOLD_MS;
}

/**
 * Fire-and-forget: trigger the next batch chunk via HTTP POST.
 * Uses a 30s timeout (up from 10s) to handle Vercel cold starts,
 * and retries once on failure to prevent silent chain breaks.
 */
export async function triggerNextChunk(path: string, body?: Record<string, unknown>): Promise<Response> {
  const url = `${env.NEXT_PUBLIC_APP_URL}${path}`;
  console.log(`[batch] triggerNextChunk: POST ${url}${body ? ` body=${JSON.stringify(body)}` : ""}`);

  const attempt = async (isRetry: boolean): Promise<Response> => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.CRON_SECRET}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => "(unreadable)");
        console.error(`[batch] triggerNextChunk ${isRetry ? "retry " : ""}failed: ${res.status} ${res.statusText} for ${url} — body: ${errorBody}`);

        // Retry once on non-success (e.g. 508 recursion protection, 502 cold start)
        if (!isRetry) {
          console.log(`[batch] triggerNextChunk: retrying in 5s...`);
          await new Promise(r => setTimeout(r, 5_000));
          return attempt(true);
        }
      } else {
        console.log(`[batch] triggerNextChunk OK: ${res.status} ${res.statusText}`);
      }

      return res;
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        console.log(`[batch] triggerNextChunk: ${isRetry ? "retry " : ""}timed out for ${url} — assuming invocation is running`);
        return new Response(null, { status: 202, statusText: "Accepted (fire-and-forget)" });
      }

      // Retry once on network errors
      if (!isRetry) {
        console.warn(`[batch] triggerNextChunk error, retrying in 5s:`, err);
        await new Promise(r => setTimeout(r, 5_000));
        return attempt(true);
      }

      console.error(`[batch] triggerNextChunk error for ${url} (after retry):`, err);
      throw err;
    }
  };

  return attempt(false);
}
