import "server-only";

import { db } from "@/db";
import { attendees, events, type Event } from "@/db/schema";
import { and, eq, inArray, isNull, sql, count } from "drizzle-orm";
import { format } from "date-fns";
import { recalculateMembershipByEmail } from "@/lib/calculate-membership";
import { invalidateCache } from "@/lib/cache-utils";
import {
  shouldNeverMerge,
  isMembersOnlyProduct,
} from "@/lib/event-patterns";

/**
 * Advisory lock key for merge operations
 * Using a fixed key ensures only one merge process runs at a time
 */
const MERGE_LOCK_KEY = 123456789; // Arbitrary but consistent

/**
 * Try to acquire an advisory lock for merge operations
 * Returns true if lock acquired, false if already held by another process
 */
async function tryAcquireMergeLock(): Promise<boolean> {
  const result = await db.execute<{ pg_try_advisory_lock: boolean }>(
    sql`SELECT pg_try_advisory_lock(${MERGE_LOCK_KEY}) as pg_try_advisory_lock`
  );
  const rows = Array.from(result);
  return rows[0]?.pg_try_advisory_lock === true;
}

/**
 * Release the advisory lock for merge operations
 */
async function releaseMergeLock(): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_unlock(${MERGE_LOCK_KEY})`);
}

/**
 * Type definitions for merge operations
 */
export interface DuplicateEventGroup {
  date: Date;
  events: Array<Event & { attendeeCount: number }>;
  sharedPrefix: string;
}

export interface MergeResult {
  success: boolean;
  primaryEventId: string;
  primaryEventName: string;
  mergedEventIds: string[];
  attendeesMoved: number;
  affectedMemberCount: number;
  error?: string;
}

export interface BatchMergeResult {
  groupsFound: number;
  groupsMerged: number;
  groupsFailed: number;
  totalEventsMerged: number;
  totalAttendeesAffected: number;
  details: Array<{
    date: string;
    originalNames: string[];
    mergedName: string;
    attendeesMoved: number;
    success: boolean;
    error?: string;
  }>;
}

/**
 * Extract first N words from a string
 */
function extractFirstNWords(name: string, n: number): string {
  const words = name.trim().split(/\s+/);
  return words.slice(0, n).join(" ");
}

/**
 * Extract the base event name by removing members-only suffixes and date patterns
 */
function extractBaseName(name: string): string {
  let baseName = name;

  // Remove members-only suffixes
  baseName = baseName
    .replace(/\s*-?\s*community\s*member.*$/i, "")
    .replace(/\s*-?\s*members?\s*(only|booking|link).*$/i, "")
    .replace(/\s*-\s*members$/i, "");

  // Remove date patterns
  baseName = removeDateFromName(baseName);

  return baseName.trim();
}

/**
 * Determine if two events should be merged
 * ONLY merge when:
 * 1. Same date
 * 2. One is a members-only variant
 * 3. Neither is in the "never merge" category
 * 4. Base names are similar
 */
function shouldMergeEvents(
  event1: { name: string; eventDate: Date },
  event2: { name: string; eventDate: Date }
): { shouldMerge: boolean; reason: string } {
  // Check if either event should never be merged
  if (shouldNeverMerge(event1.name) || shouldNeverMerge(event2.name)) {
    return {
      shouldMerge: false,
      reason: "Event type should never be auto-merged (e.g., Book Club)",
    };
  }

  // Check if same date (compare date portion only)
  const date1 = new Date(event1.eventDate).toDateString();
  const date2 = new Date(event2.eventDate).toDateString();
  if (date1 !== date2) {
    return { shouldMerge: false, reason: "Different dates" };
  }

  // Check if at least one is a members-only variant
  const e1Members = isMembersOnlyProduct(event1.name);
  const e2Members = isMembersOnlyProduct(event2.name);

  if (!e1Members && !e2Members) {
    return {
      shouldMerge: false,
      reason: "Neither event is a members-only variant",
    };
  }

  if (e1Members && e2Members) {
    return {
      shouldMerge: false,
      reason: "Both events are members-only variants (shouldn't happen)",
    };
  }

  // Check if base names are similar
  const baseName1 = extractBaseName(event1.name).toLowerCase();
  const baseName2 = extractBaseName(event2.name).toLowerCase();

  // Compare base names - allow for minor variations
  const similar =
    baseName1 === baseName2 ||
    baseName1.startsWith(baseName2) ||
    baseName2.startsWith(baseName1);

  if (!similar) {
    return {
      shouldMerge: false,
      reason: `Base names don't match: "${baseName1}" vs "${baseName2}"`,
    };
  }

  return {
    shouldMerge: true,
    reason: `Members-only variant merge: "${extractBaseName(event1.name)}"`,
  };
}

/**
 * Remove date patterns from event name
 * Handles formats: DD/MM/YYYY, YYYY-MM-DD, "Month DD, YYYY"
 */
function removeDateFromName(name: string): string {
  return name
    .replace(/\s*-?\s*\d{1,2}\/\d{1,2}\/\d{4}\s*$/, "") // DD/MM/YYYY at end
    .replace(/\s*-?\s*\d{4}-\d{1,2}-\d{1,2}\s*$/, "") // YYYY-MM-DD at end
    .replace(/\s*-?\s*\w+\s+\d{1,2},\s*\d{4}\s*$/, "") // Month DD, YYYY at end
    .trim();
}

/**
 * Create merged event name for members-only merge
 * Simply uses the regular event name (non-members-only) with date formatting
 * This prevents the corruption from combining different event names
 */
function createMergedEventName(events: Array<Event & { attendeeCount: number }>, eventDate: Date): string {
  // Find the regular (non-members-only) event - this is the canonical name
  const regularEvent = events.find(e => !isMembersOnlyProduct(e.name));

  if (!regularEvent) {
    // Fallback: use the event with most attendees
    const sorted = [...events].sort((a, b) => b.attendeeCount - a.attendeeCount);
    const primary = sorted[0];
    if (!primary) {
      return `Merged Event - ${format(eventDate, "EEEE, MMMM d, yyyy")}`;
    }
    // Clean the members-only name
    const baseName = extractBaseName(primary.name);
    return `${baseName} - ${format(eventDate, "EEEE, MMMM d, yyyy")}`;
  }

  // Use the regular event's base name
  const baseName = extractBaseName(regularEvent.name);

  // Format date
  const formattedDate = format(eventDate, "EEEE, MMMM d, yyyy");

  // Build final name - simple and clean
  let finalName = `${baseName} - ${formattedDate}`;

  // Truncate if exceeds database limit (255 chars)
  if (finalName.length > 255) {
    finalName = finalName.substring(0, 252) + "...";
  }

  return finalName;
}

/**
 * Find events that should be merged based on smart criteria:
 * - Same date
 * - One must be a members-only variant of the other
 * - Never merge Book Club or other distinct event types
 * - Only unmerged events with WooCommerce product IDs
 */
export async function findDuplicateEvents(): Promise<DuplicateEventGroup[]> {
  console.log("[merge-events] Finding merge candidates using smart criteria...");

  // First, get all unmerged events with WooCommerce IDs
  const result = await db.execute<{
    id: string;
    name: string;
    event_date: Date;
    woocommerce_product_id: string;
    created_at: Date;
    updated_at: Date;
    attendee_count: string;
  }>(sql`
    SELECT
      e.id,
      e.name,
      e.event_date,
      e.woocommerce_product_id,
      e.created_at,
      e.updated_at,
      COUNT(a.id) as attendee_count
    FROM tablecn_events e
    LEFT JOIN tablecn_attendees a ON e.id = a.event_id
    WHERE e.woocommerce_product_id IS NOT NULL
      AND e.merged_into_event_id IS NULL
      AND LENGTH(TRIM(e.name)) > 0
    GROUP BY e.id, e.name, e.event_date, e.woocommerce_product_id, e.created_at, e.updated_at
    ORDER BY e.event_date DESC
  `);

  const allEvents = Array.from(result).map(row => ({
    id: row.id,
    name: row.name,
    eventDate: new Date(row.event_date),
    woocommerceProductId: row.woocommerce_product_id,
    mergedIntoEventId: null,
    mergedProductIds: [] as string[],
    isMembersOnlyProduct: isMembersOnlyProduct(row.name),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    attendeeCount: parseInt(row.attendee_count || "0"),
  }));

  console.log(`[merge-events] Analyzing ${allEvents.length} events for merge candidates...`);

  // Group events by date for efficient comparison
  const eventsByDate = new Map<string, typeof allEvents>();
  for (const event of allEvents) {
    const dateKey = event.eventDate.toDateString();
    if (!eventsByDate.has(dateKey)) {
      eventsByDate.set(dateKey, []);
    }
    eventsByDate.get(dateKey)!.push(event);
  }

  // Find valid merge groups (only members-only variants with their parent events)
  const mergeGroups: DuplicateEventGroup[] = [];
  const processedIds = new Set<string>();

  for (const [dateKey, dateEvents] of eventsByDate) {
    if (dateEvents.length < 2) continue;

    // Find members-only events and their potential parent events
    const membersOnlyEvents = dateEvents.filter(e => isMembersOnlyProduct(e.name));
    const regularEvents = dateEvents.filter(e => !isMembersOnlyProduct(e.name));

    for (const membersEvent of membersOnlyEvents) {
      if (processedIds.has(membersEvent.id)) continue;

      // Find matching regular event
      for (const regularEvent of regularEvents) {
        if (processedIds.has(regularEvent.id)) continue;

        const { shouldMerge, reason } = shouldMergeEvents(regularEvent, membersEvent);

        if (shouldMerge) {
          console.log(`[merge-events] ✅ Merge candidate found:`);
          console.log(`[merge-events]    Regular: "${regularEvent.name}"`);
          console.log(`[merge-events]    Members: "${membersEvent.name}"`);
          console.log(`[merge-events]    Reason: ${reason}`);

          mergeGroups.push({
            date: regularEvent.eventDate,
            events: [regularEvent, membersEvent],
            sharedPrefix: extractBaseName(regularEvent.name),
          });

          processedIds.add(membersEvent.id);
          processedIds.add(regularEvent.id);
          break; // Found match, move to next members-only event
        } else {
          console.log(`[merge-events] ❌ Skipping potential pair:`);
          console.log(`[merge-events]    Event 1: "${regularEvent.name}"`);
          console.log(`[merge-events]    Event 2: "${membersEvent.name}"`);
          console.log(`[merge-events]    Reason: ${reason}`);
        }
      }
    }
  }

  console.log(`[merge-events] Found ${mergeGroups.length} valid merge groups`);

  if (mergeGroups.length === 0) {
    console.log(`[merge-events] ✓ No events need merging - all events are correctly separated`);
  }

  return mergeGroups;
}

/**
 * Merge a single duplicate event group
 */
export async function mergeEventGroup(group: DuplicateEventGroup): Promise<MergeResult> {
  const dateStr = format(group.date, "yyyy-MM-dd");
  console.log(`[merge-events] Merging group: ${group.sharedPrefix} on ${dateStr}`);

  try {
    // Query ACTUAL attendee counts for each event (don't trust stale attendeeCount field)
    const eventsWithCounts = await Promise.all(
      group.events.map(async (event) => {
        const result = await db
          .select({ count: count() })
          .from(attendees)
          .where(eq(attendees.eventId, event.id));
        return {
          ...event,
          actualAttendeeCount: result[0]?.count || 0,
        };
      })
    );

    // Sort events: most attendees first, then by product ID
    const sortedEvents = [...eventsWithCounts].sort((a, b) => {
      if (b.actualAttendeeCount !== a.actualAttendeeCount) {
        return b.actualAttendeeCount - a.actualAttendeeCount;  // Use REAL count
      }
      return (a.woocommerceProductId || "").localeCompare(b.woocommerceProductId || "");
    });

    const primary = sortedEvents[0];
    if (!primary) {
      throw new Error("No primary event found in group");
    }

    const secondaries = sortedEvents.slice(1);

    console.log(`[merge-events] 🔀 Merging group: ${group.sharedPrefix} on ${dateStr}`);
    console.log(`[merge-events]   Primary: "${primary.name}"`);
    console.log(`[merge-events]     └─ ${primary.actualAttendeeCount} attendees (ACTUAL), product ${primary.woocommerceProductId}`);
    console.log(`[merge-events]   Secondary events (${secondaries.length}):`);
    secondaries.forEach(e => {
      console.log(`[merge-events]     └─ "${e.name}" (${e.actualAttendeeCount} attendees ACTUAL, product ${e.woocommerceProductId})`);
    });

    // Create merged name
    const mergedName = createMergedEventName(group.events, group.date);
    console.log(`[merge-events]   📝 New merged name: "${mergedName}"`);

    let attendeesMoved = 0;
    const secondaryIds = secondaries.map(e => e.id);

    // Collect ALL product IDs that will be part of this merged event
    const allProductIds = sortedEvents
      .map(e => e.woocommerceProductId)
      .filter((id): id is string => id !== null && id !== undefined);

    console.log(`[merge-events]   📦 Storing merged product IDs: ${allProductIds.join(", ")}`);

    // Perform merge in transaction
    await db.transaction(async (tx) => {
      // 1. Get all attendees from secondary events
      const secondaryAttendees = await tx
        .select()
        .from(attendees)
        .where(inArray(attendees.eventId, secondaryIds));

      attendeesMoved = secondaryAttendees.length;

      console.log(`[merge-events]   👥 Moving ${secondaryAttendees.length} attendees to primary event`);

      // 2. Move attendees to primary event (preserve their sourceProductId if set)
      if (secondaryAttendees.length > 0) {
        await tx
          .update(attendees)
          .set({ eventId: primary.id })
          .where(inArray(attendees.eventId, secondaryIds));
      }

      // 3. Update primary event: name AND mergedProductIds
      await tx
        .update(events)
        .set({
          name: mergedName,
          mergedProductIds: allProductIds, // Store ALL product IDs for future sync
        })
        .where(eq(events.id, primary.id));

      // 4. DELETE secondary events (unique constraint prevents duplicates now)
      if (secondaryIds.length > 0) {
        await tx
          .delete(events)
          .where(inArray(events.id, secondaryIds));

        console.log(`[merge-events]   🗑️  Deleted ${secondaryIds.length} secondary events`);
      }
    });

    console.log(`[merge-events] ✅ Transaction committed successfully`);

    // Post-transaction cleanup

    // Clear WooCommerce cache for all affected product IDs
    try {
      for (const event of group.events) {
        if (event.woocommerceProductId) {
          // Clear cache for this product's orders
          const cacheKey = `orders:product:${event.woocommerceProductId}:date:${dateStr}`;
          await invalidateCache(cacheKey);
        }
      }
      console.log(`[merge-events] Cleared cache for ${group.events.length} products`);
    } catch (error) {
      console.error(`[merge-events] Error clearing cache:`, error);
      // Non-fatal, continue
    }

    // Recalculate membership for affected members
    let affectedMemberCount = 0;
    try {
      // Get all unique emails from affected attendees
      const allAttendees = await db
        .select({ email: attendees.email })
        .from(attendees)
        .where(eq(attendees.eventId, primary.id));

      const uniqueEmails = [...new Set(allAttendees.map(a => a.email))];
      affectedMemberCount = uniqueEmails.length;

      console.log(`[merge-events] Recalculating membership for ${affectedMemberCount} members`);

      for (const email of uniqueEmails) {
        try {
          await recalculateMembershipByEmail(email);
        } catch (error) {
          console.error(`[merge-events] Error recalculating membership for ${email}:`, error);
          // Continue with other members
        }
      }
    } catch (error) {
      console.error(`[merge-events] Error in membership recalculation:`, error);
      // Non-fatal, continue
    }

    console.log(`[merge-events] ✨ Successfully merged ${secondaryIds.length} events into ${primary.id}`);
    console.log(`[merge-events]    └─ ${attendeesMoved} attendees moved, ${affectedMemberCount} members recalculated`);

    return {
      success: true,
      primaryEventId: primary.id,
      primaryEventName: mergedName,
      mergedEventIds: secondaryIds,
      attendeesMoved,
      affectedMemberCount,
    };
  } catch (error) {
    console.error(`[merge-events] Error merging group:`, error);
    return {
      success: false,
      primaryEventId: "",
      primaryEventName: "",
      mergedEventIds: [],
      attendeesMoved: 0,
      affectedMemberCount: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Find and merge all duplicate events
 * Main entry point for automatic merging
 * Uses PostgreSQL advisory lock to prevent concurrent merge operations
 */
export async function mergeDuplicateEvents(): Promise<BatchMergeResult> {
  console.log("[merge-events] Starting batch merge process...");
  const startTime = Date.now();

  // Try to acquire lock - if another process is merging, skip
  const lockAcquired = await tryAcquireMergeLock();
  if (!lockAcquired) {
    console.log("[merge-events] Another merge process is running, skipping...");
    return {
      groupsFound: 0,
      groupsMerged: 0,
      groupsFailed: 0,
      totalEventsMerged: 0,
      totalAttendeesAffected: 0,
      details: [],
    };
  }

  console.log("[merge-events] Lock acquired, proceeding with merge...");

  try {
    const duplicateGroups = await findDuplicateEvents();

    const result: BatchMergeResult = {
      groupsFound: duplicateGroups.length,
      groupsMerged: 0,
      groupsFailed: 0,
      totalEventsMerged: 0,
      totalAttendeesAffected: 0,
      details: [],
    };

    if (duplicateGroups.length === 0) {
      console.log("[merge-events] No duplicate groups found");
      return result;
    }

    // Process each group
    for (const group of duplicateGroups) {
      const dateStr = format(group.date, "yyyy-MM-dd");
      const originalNames = group.events.map(e => e.name);

      const mergeResult = await mergeEventGroup(group);

      if (mergeResult.success) {
        result.groupsMerged++;
        result.totalEventsMerged += mergeResult.mergedEventIds.length;
        result.totalAttendeesAffected += mergeResult.attendeesMoved;

        result.details.push({
          date: dateStr,
          originalNames,
          mergedName: mergeResult.primaryEventName,
          attendeesMoved: mergeResult.attendeesMoved,
          success: true,
        });
      } else {
        result.groupsFailed++;

        result.details.push({
          date: dateStr,
          originalNames,
          mergedName: "",
          attendeesMoved: 0,
          success: false,
          error: mergeResult.error,
        });
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[merge-events] Batch merge completed in ${duration}ms`);
    console.log(`[merge-events] Groups merged: ${result.groupsMerged}/${result.groupsFound}`);
    console.log(`[merge-events] Total events merged: ${result.totalEventsMerged}`);
    console.log(`[merge-events] Total attendees affected: ${result.totalAttendeesAffected}`);

    return result;
  } finally {
    // Always release the lock
    await releaseMergeLock();
    console.log("[merge-events] Lock released");
  }
}
