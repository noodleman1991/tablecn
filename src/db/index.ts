import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/env.js";

import * as schema from "./schema";

const client = postgres(env.DATABASE_URL, {
  max: 20,
  idle_timeout: 30,
  connect_timeout: 30,
});
export const db = drizzle(client, { schema });

/**
 * Retry a database operation once on CONNECT_TIMEOUT.
 * Handles Neon cold starts where the first connection attempt may fail.
 */
export async function withDbRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const cause = error?.cause ?? error;
    if (cause?.code === "CONNECT_TIMEOUT") {
      console.warn("[db] CONNECT_TIMEOUT, retrying in 2s...");
      await new Promise((r) => setTimeout(r, 2000));
      return await fn();
    }
    throw error;
  }
}
