/**
 * Loops.so Integration Helper
 *
 * Handles syncing active community members to Loops.so for email marketing.
 * - Real-time sync on member status changes
 * - Rate limiting (10 req/sec)
 * - Comprehensive error handling
 * - Audit logging to database
 */

import { db } from "@/db";
import { loopsSyncLog, type Member } from "@/db/schema";
import { env } from "@/env";

const LOOPS_API_BASE_URL = "https://app.loops.so/api/v1";
const RATE_LIMIT_PER_SECOND = 10;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Rate limiter state
let requestQueue: Array<() => Promise<void>> = [];
let requestsThisSecond = 0;
let rateLimitResetTime = Date.now() + 1000;

/**
 * Rate limiter to respect Loops API limit of 10 requests per second
 */
async function rateLimitedRequest<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const execute = async () => {
      const now = Date.now();

      // Reset counter if we're in a new second
      if (now >= rateLimitResetTime) {
        requestsThisSecond = 0;
        rateLimitResetTime = now + 1000;
      }

      // If we've hit the limit, wait and try again
      if (requestsThisSecond >= RATE_LIMIT_PER_SECOND) {
        const waitTime = rateLimitResetTime - now;
        setTimeout(execute, waitTime);
        return;
      }

      // Execute the request
      requestsThisSecond++;
      try {
        const result = await fn();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };

    execute();
  });
}

/**
 * Make HTTP request to Loops API with retry logic
 */
async function loopsApiRequest(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: unknown,
  retryCount = 0
): Promise<Response> {
  const url = `${LOOPS_API_BASE_URL}${endpoint}`;

  try {
    const response = await rateLimitedRequest(async () => {
      return fetch(url, {
        method,
        headers: {
          "Authorization": `Bearer ${env.LOOPS_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    });

    // Handle rate limiting (429) with exponential backoff
    if (response.status === 429 && retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
      console.warn(`[Loops] Rate limited, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return loopsApiRequest(endpoint, method, body, retryCount + 1);
    }

    // Handle server errors (5xx) with retry
    if (response.status >= 500 && retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
      console.warn(`[Loops] Server error ${response.status}, retrying in ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return loopsApiRequest(endpoint, method, body, retryCount + 1);
    }

    return response;
  } catch (error) {
    // Network errors - retry
    if (retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
      console.warn(`[Loops] Network error, retrying in ${delay}ms:`, error);
      await new Promise(resolve => setTimeout(resolve, delay));
      return loopsApiRequest(endpoint, method, body, retryCount + 1);
    }
    throw error;
  }
}

/**
 * Format member data for Loops API
 *
 * NOTE: We set `subscribed: true` because Loops requires contacts to be
 * subscribed before they can be added to mailing lists. Per Loops docs:
 * "You cannot add contacts to mailing lists if they are unsubscribed."
 *
 * We do NOT set `source` to preserve the contact's original source
 * (e.g., "CSV Import", "Newsletter Signup Form"). This ensures newsletter
 * subscribers who become community members remain in the weekly newsletter segment.
 */
function formatMemberForLoops(member: Member) {
  return {
    email: member.email,
    firstName: member.firstName || "",
    lastName: member.lastName || "",
    totalEventsAttended: member.totalEventsAttended,
    lastEventDate: member.lastEventDate?.toISOString() || null,
    membershipExpiresAt: member.membershipExpiresAt?.toISOString() || null,
    manuallyAdded: member.manuallyAdded,
    subscribed: true, // Required for mailing list membership
    // source: intentionally not set - preserve original source
    // Add to "Active Community Members" list
    mailingLists: {
      [env.LOOPS_ACTIVE_MEMBERS_LIST_ID]: true,
    },
  };
}

/**
 * Log sync operation to database
 */
async function logLoopsSync(
  operation: "sync" | "remove",
  email: string,
  status: "success" | "failed",
  memberId?: string | null,
  errorMessage?: string | null,
  loopsContactId?: string | null
): Promise<void> {
  try {
    await db.insert(loopsSyncLog).values({
      memberId: memberId || null,
      email,
      operation,
      status,
      errorMessage: errorMessage || null,
      loopsContactId: loopsContactId || null,
    });
  } catch (error) {
    // Don't fail the sync if logging fails, just log to console
    console.error("[Loops] Failed to log sync operation:", error);
  }
}

/**
 * Sync a member to Loops.so (create or update contact)
 * Only syncs if member is active
 *
 * @param member - Member object to sync
 * @returns true if successful, false otherwise
 */
export async function syncMemberToLoops(member: Member): Promise<boolean> {
  // Only sync active members
  if (!member.isActiveMember) {
    console.log(`[Loops] Skipping sync for inactive member: ${member.email}`);
    return false;
  }

  const contactData = formatMemberForLoops(member);

  try {
    const response = await loopsApiRequest("/contacts/update", "POST", contactData);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json() as { id?: string; success?: boolean };

    await logLoopsSync(
      "sync",
      member.email,
      "success",
      member.id,
      null,
      result.id || null
    );

    console.log(`[Loops] Successfully synced member: ${member.email}`);
    return true;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await logLoopsSync(
      "sync",
      member.email,
      "failed",
      member.id,
      errorMessage
    );

    console.error(`[Loops] Failed to sync member ${member.email}:`, errorMessage);
    return false;
  }
}

/**
 * Remove a member from Loops.so
 * First removes from mailing list, then optionally deletes contact entirely
 *
 * @param email - Email address to remove
 * @param memberId - Optional member ID for logging
 * @param deleteContact - Whether to delete the contact entirely (default: false, just remove from list)
 * @returns true if successful, false otherwise
 */
export async function removeMemberFromLoops(
  email: string,
  memberId?: string,
  deleteContact: boolean = false
): Promise<boolean> {
  try {
    // Strategy 1: Remove from mailing list (keeps contact, just unsubscribes from list)
    const updateResponse = await loopsApiRequest("/contacts/update", "POST", {
      email,
      mailingLists: {
        [env.LOOPS_ACTIVE_MEMBERS_LIST_ID]: false, // Unsubscribe from list
      },
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      throw new Error(`HTTP ${updateResponse.status}: ${errorText}`);
    }

    await logLoopsSync(
      "remove",
      email,
      "success",
      memberId || null,
      null,
      null
    );

    console.log(`[Loops] Successfully removed member from list: ${email}`);

    // Strategy 2: Optionally delete contact entirely (use with caution)
    if (deleteContact) {
      const deleteResponse = await loopsApiRequest("/contacts/delete", "POST", { email });

      if (!deleteResponse.ok) {
        console.warn(`[Loops] Failed to delete contact ${email}, but list removal succeeded`);
      } else {
        console.log(`[Loops] Also deleted contact entirely: ${email}`);
      }
    }

    return true;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await logLoopsSync(
      "remove",
      email,
      "failed",
      memberId || null,
      errorMessage
    );

    console.error(`[Loops] Failed to remove member ${email}:`, errorMessage);
    return false;
  }
}

/**
 * Test Loops API connection
 *
 * @returns true if API key is valid
 */
export async function testLoopsConnection(): Promise<boolean> {
  try {
    const response = await loopsApiRequest("/api-key", "GET");
    return response.ok;
  } catch (error) {
    console.error("[Loops] Connection test failed:", error);
    return false;
  }
}

/**
 * Get sync statistics from logs
 */
export async function getLoopsSyncStats(since?: Date) {
  const logs = since
    ? await db.query.loopsSyncLog.findMany({
        where: (log, { gte }) => gte(log.syncedAt, since),
      })
    : await db.query.loopsSyncLog.findMany({
        limit: 1000,
        orderBy: (log, { desc }) => [desc(log.syncedAt)],
      });

  const stats = {
    total: logs.length,
    successful: logs.filter(l => l.status === "success").length,
    failed: logs.filter(l => l.status === "failed").length,
    synced: logs.filter(l => l.operation === "sync" && l.status === "success").length,
    removed: logs.filter(l => l.operation === "remove" && l.status === "success").length,
  };

  return stats;
}

/**
 * Reconcile DB active members with Loops Active Community Members list
 *
 * This function ensures the DB (source of truth) and Loops stay in sync:
 * - For each active member in DB: ensure they're in the Active Community Members list
 * - For each inactive member in DB: ensure they're NOT in the list
 *
 * This should be called during the weekly cron to catch any sync gaps
 * (e.g., API failures, timing issues, etc.)
 *
 * @param members - All members from the database
 * @returns Statistics about what was checked and fixed
 */
export async function reconcileLoopsMembership(members: Member[]): Promise<{
  checked: number;
  fixed: number;
  errors: number;
  details: { email: string; action: string }[];
}> {
  const stats = {
    checked: 0,
    fixed: 0,
    errors: 0,
    details: [] as { email: string; action: string }[],
  };

  console.log(`[Loops Reconcile] Starting reconciliation for ${members.length} members...`);

  for (const member of members) {
    try {
      // Check contact in Loops
      const response = await loopsApiRequest(
        `/contacts/find?email=${encodeURIComponent(member.email)}`,
        "GET"
      );

      if (!response.ok) {
        // Contact might not exist in Loops at all
        if (response.status === 404 || response.status === 400) {
          // If member is active but not in Loops, sync them
          if (member.isActiveMember) {
            await syncMemberToLoops(member);
            stats.fixed++;
            stats.details.push({ email: member.email, action: "created_and_added_to_list" });
          }
        } else {
          stats.errors++;
          console.error(`[Loops Reconcile] Error finding ${member.email}: HTTP ${response.status}`);
        }
        continue;
      }

      const contacts = await response.json() as Array<{
        mailingLists?: Record<string, boolean>;
        subscribed?: boolean;
      }>;
      const loopsContact = contacts[0];
      stats.checked++;

      if (member.isActiveMember) {
        // Active in DB - should be in list with subscribed=true
        const inList = loopsContact?.mailingLists?.[env.LOOPS_ACTIVE_MEMBERS_LIST_ID] === true;
        const isSubscribed = loopsContact?.subscribed === true;

        if (!inList || !isSubscribed) {
          // FIX: Sync to add to list and ensure subscribed=true
          await syncMemberToLoops(member);
          stats.fixed++;
          stats.details.push({
            email: member.email,
            action: !inList ? "added_to_list" : "set_subscribed_true",
          });
        }
      } else {
        // Inactive in DB - should NOT be in list
        const inList = loopsContact?.mailingLists?.[env.LOOPS_ACTIVE_MEMBERS_LIST_ID] === true;

        if (inList) {
          // FIX: Remove from list
          await removeMemberFromLoops(member.email, member.id);
          stats.fixed++;
          stats.details.push({ email: member.email, action: "removed_from_list" });
        }
      }

      // Rate limiting - small delay between requests to respect 10 req/sec limit
      await new Promise((r) => setTimeout(r, 110));
    } catch (error) {
      stats.errors++;
      console.error(
        `[Loops Reconcile] Error checking ${member.email}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  console.log(`[Loops Reconcile] Complete! Checked: ${stats.checked}, Fixed: ${stats.fixed}, Errors: ${stats.errors}`);

  if (stats.details.length > 0) {
    console.log(`[Loops Reconcile] Fixed contacts:`);
    for (const detail of stats.details) {
      console.log(`  - ${detail.email}: ${detail.action}`);
    }
  }

  return stats;
}
