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
const BATCH_TTL_SECONDS = 3600; // 1 hour
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

function batchKey(type: string): string {
  return `${BATCH_KEY_PREFIX}${type}`;
}

export async function startBatchJob(
  type: string,
  total: number,
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
    processed: 0,
    offset: 0,
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

export function triggerNextChunk(path: string): void {
  const url = `${env.NEXT_PUBLIC_APP_URL}${path}`;

  fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CRON_SECRET}`,
      "Content-Type": "application/json",
    },
  }).catch((err) => {
    console.error(`[batch] Failed to trigger next chunk at ${path}:`, err);
  });
}
