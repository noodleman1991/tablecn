import "server-only";

import { db } from "@/db";
import { woocommerceCache } from "@/db/schema";
import { eq, lt } from "drizzle-orm";

/**
 * Get cached data by key
 * Returns null if cache miss or expired
 */
export async function getCachedData<T>(key: string): Promise<T | null> {
  try {
    const cached = await db
      .select()
      .from(woocommerceCache)
      .where(eq(woocommerceCache.cacheKey, key))
      .limit(1);

    if (cached.length === 0) {
      return null;
    }

    const entry = cached[0];

    // Check if expired
    if (entry.expiresAt < new Date()) {
      // Clean up expired entry
      await db
        .delete(woocommerceCache)
        .where(eq(woocommerceCache.cacheKey, key));
      return null;
    }

    return entry.cacheData as T;
  } catch (error) {
    console.error(`[cache] Error fetching cache for key ${key}:`, error);
    return null;
  }
}

/**
 * Set cached data with TTL
 */
export async function setCachedData<T>(
  key: string,
  data: T,
  ttlSeconds: number
): Promise<void> {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    // Upsert cache entry
    await db
      .insert(woocommerceCache)
      .values({
        cacheKey: key,
        cacheData: data as any,
        cachedAt: now,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: woocommerceCache.cacheKey,
        set: {
          cacheData: data as any,
          cachedAt: now,
          expiresAt,
        },
      });

    console.log(`[cache] Cached data for key ${key} (TTL: ${ttlSeconds}s)`);
  } catch (error) {
    console.error(`[cache] Error setting cache for key ${key}:`, error);
  }
}

/**
 * Invalidate cache by key
 */
export async function invalidateCache(key: string): Promise<void> {
  try {
    await db.delete(woocommerceCache).where(eq(woocommerceCache.cacheKey, key));
    console.log(`[cache] Invalidated cache for key ${key}`);
  } catch (error) {
    console.error(`[cache] Error invalidating cache for key ${key}:`, error);
  }
}

/**
 * Get cache age in seconds
 * Returns null if cache doesn't exist or is expired
 */
export async function getCacheAge(key: string): Promise<number | null> {
  try {
    const cached = await db
      .select()
      .from(woocommerceCache)
      .where(eq(woocommerceCache.cacheKey, key))
      .limit(1);

    if (cached.length === 0) {
      return null;
    }

    const entry = cached[0];

    // Check if expired
    if (entry.expiresAt < new Date()) {
      return null;
    }

    const ageMs = Date.now() - entry.cachedAt.getTime();
    return Math.floor(ageMs / 1000); // Return age in seconds
  } catch (error) {
    console.error(`[cache] Error getting cache age for key ${key}:`, error);
    return null;
  }
}

/**
 * Clean up all expired cache entries
 * Useful for cron jobs
 */
export async function cleanupExpiredCache(): Promise<number> {
  try {
    const result = await db
      .delete(woocommerceCache)
      .where(lt(woocommerceCache.expiresAt, new Date()));

    const deletedCount = result.rowCount ?? 0;
    console.log(`[cache] Cleaned up ${deletedCount} expired cache entries`);
    return deletedCount;
  } catch (error) {
    console.error("[cache] Error cleaning up expired cache:", error);
    return 0;
  }
}
