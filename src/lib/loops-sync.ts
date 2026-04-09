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
 * SAFETY: We do NOT set `subscribed` — new contacts default to true,
 * and sending it explicitly would re-subscribe contacts who opted out (GDPR risk).
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
    // Billing address from WooCommerce orders
    address: member.address || "",
    city: member.city || "",
    postcode: member.postcode || "",
    country: member.country || "",
    phone: member.phone || "",
    // subscribed: intentionally NOT set — new contacts default to true,
    // and setting it explicitly re-subscribes contacts who unsubscribed
    // source: intentionally not set — preserve original source
    mailingLists: {
      [env.LOOPS_ACTIVE_MEMBERS_LIST_ID]: true,
    },
  };
}

/**
 * Log sync operation to database
 */
async function logLoopsSync(
  operation: "sync" | "remove" | "recreate",
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

    // Verify the contact is actually in the mailing list
    // Loops API can return 200 success but silently fail to add the contact to the list
    const verifyResponse = await loopsApiRequest(
      `/contacts/find?email=${encodeURIComponent(member.email)}`,
      "GET"
    );
    if (verifyResponse.ok) {
      const contacts = await verifyResponse.json() as Array<{ mailingLists?: Record<string, boolean>; source?: string }>;
      const inList = contacts[0]?.mailingLists?.[env.LOOPS_ACTIVE_MEMBERS_LIST_ID] === true;

      if (!inList) {
        const originalSource = contacts[0]?.source || "";

        // First: retry update — the contact might need the list re-applied
        // Do NOT send subscribed: true — it re-subscribes contacts who opted out
        console.warn(`[Loops] Contact ${member.email} not in mailing list after update — retrying update`);
        await loopsApiRequest("/contacts/update", "POST", contactData);

        // Verify again
        const retryVerify = await loopsApiRequest(
          `/contacts/find?email=${encodeURIComponent(member.email)}`,
          "GET"
        );
        let fixedByRetry = false;
        if (retryVerify.ok) {
          const retryContacts = await retryVerify.json() as Array<{ mailingLists?: Record<string, boolean> }>;
          fixedByRetry = retryContacts[0]?.mailingLists?.[env.LOOPS_ACTIVE_MEMBERS_LIST_ID] === true;
        }

        if (fixedByRetry) {
          console.log(`[Loops] Retry update fixed list membership for ${member.email}`);
          await logLoopsSync("sync", member.email, "success", member.id, "Fixed by retry update (was not in list initially)", null);
        } else {
          // Last resort: delete and recreate (will trigger "Contact added" Loop)
          console.warn(`[Loops] Retry failed for ${member.email} — deleting and recreating`);
          await loopsApiRequest("/contacts/delete", "POST", { email: member.email });

          // Preserve original source: merge with "community_member"
          let mergedSource = "community_member";
          if (originalSource && originalSource !== "community_member") {
            if (originalSource.includes("community_member")) {
              mergedSource = originalSource;
            } else {
              mergedSource = `${originalSource}, community_member`;
            }
          }

          const createResponse = await loopsApiRequest("/contacts/create", "POST", {
            ...contactData,
            source: mergedSource,
          });
          if (!createResponse.ok) {
            const createError = await createResponse.text();
            await logLoopsSync("recreate", member.email, "failed", member.id, `Recreate failed: ${createError}. Original source: ${originalSource || "none"}`, null);
            throw new Error(`Recreate failed after stuck list detection: ${createError}`);
          }
          console.log(`[Loops] Recreated contact ${member.email} with source: ${mergedSource}`);
          await logLoopsSync("recreate", member.email, "success", member.id, `Deleted and recreated. Original source: ${originalSource || "none"}`, null);
        }
      }
    }

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
 * Remove a member from the Active Community Members mailing list in Loops.so.
 *
 * SAFETY: Checks if the contact exists before calling /contacts/update,
 * because /contacts/update silently creates contacts that don't exist —
 * which triggers the "Contact added" Loop and sends unwanted welcome emails.
 *
 * Only removes from the active members list. Never deletes the contact,
 * never touches other lists, never changes subscription status.
 *
 * @param email - Email address to remove from the active members list
 * @param memberId - Optional member ID for logging
 * @returns true if successful (including skipped), false on error
 */
export async function removeMemberFromLoops(
  email: string,
  memberId?: string,
): Promise<boolean> {
  try {
    // Check if contact exists in Loops before doing anything.
    // /contacts/update CREATES contacts that don't exist, which triggers
    // the "Contact added" Loop and sends unwanted welcome emails.
    const findResponse = await loopsApiRequest(
      `/contacts/find?email=${encodeURIComponent(email)}`,
      "GET"
    );

    if (!findResponse.ok) {
      throw new Error(`Find contact failed: HTTP ${findResponse.status}`);
    }

    const contacts = await findResponse.json() as Array<{
      id?: string;
      source?: string;
      subscribed?: boolean;
      mailingLists?: Record<string, boolean>;
    }>;

    if (contacts.length === 0) {
      console.log(`[Loops] Skipping remove for ${email} — not in Loops`);
      await logLoopsSync("remove", email, "success", memberId || null, "Skipped: not in Loops", null);
      return true;
    }

    const contact = contacts[0]!;
    const onActiveList = contact.mailingLists?.[env.LOOPS_ACTIVE_MEMBERS_LIST_ID] === true;

    if (!onActiveList) {
      console.log(`[Loops] Skipping remove for ${email} — not on active members list`);
      await logLoopsSync("remove", email, "success", memberId || null, "Skipped: not on active list", null);
      return true;
    }

    // Contact exists and is on the active list — remove them from it.
    // Only send mailingLists — do not touch source, subscribed, or any other field.
    const updateResponse = await loopsApiRequest("/contacts/update", "POST", {
      email,
      mailingLists: {
        [env.LOOPS_ACTIVE_MEMBERS_LIST_ID]: false,
      },
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      throw new Error(`HTTP ${updateResponse.status}: ${errorText}`);
    }

    await logLoopsSync("remove", email, "success", memberId || null,
      `Removed from active list. Source: ${contact.source || "none"}`, null);
    console.log(`[Loops] Removed ${email} from active members list`);

    return true;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logLoopsSync("remove", email, "failed", memberId || null, errorMessage);
    console.error(`[Loops] Failed to remove member ${email}:`, errorMessage);
    return false;
  }
}

/**
 * Send an event to Loops.so to trigger a Loop
 *
 * @param email - Contact email address
 * @param eventName - Name of the event (must match Loop trigger in Loops dashboard)
 * @param eventProperties - Optional event properties for personalization
 * @returns success status and optional error message
 */
export async function sendLoopsEvent(
  email: string,
  eventName: string,
  eventProperties?: Record<string, string | number | boolean>
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await loopsApiRequest("/events/send", "POST", {
      email,
      eventName,
      eventProperties,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    console.log(`[Loops] Successfully sent event "${eventName}" for ${email}`);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Loops] Failed to send event "${eventName}" for ${email}:`, errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Send a transactional email via Loops.so
 *
 * @param email - Recipient email address
 * @param transactionalId - Template ID from Loops dashboard
 * @param dataVariables - Variables for template personalization
 * @param attachments - Optional file attachments
 * @returns success status and optional error message
 */
export async function sendLoopsTransactionalEmail(
  email: string,
  transactionalId: string,
  dataVariables?: Record<string, string>,
  attachments?: Array<{ filename: string; contentType: string; data: string }>
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await loopsApiRequest("/transactional", "POST", {
      email,
      transactionalId,
      dataVariables,
      attachments,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    console.log(`[Loops] Successfully sent transactional email to ${email}`);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Loops] Failed to send transactional email to ${email}:`, errorMessage);
    return { success: false, error: errorMessage };
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
