import "server-only";

import { db } from "@/db";
import { attendees, events, type Event } from "@/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { format } from "date-fns";
import { recalculateMembershipByEmail } from "@/lib/calculate-membership";
import { invalidateCache } from "@/lib/cache-utils";

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
 * Create merged event name combining variations
 * Format: "{shared prefix} {diff1} and {diff2} - {formatted date}"
 */
function createMergedEventName(events: Array<Event & { attendeeCount: number }>, eventDate: Date): string {
  // Sort by attendee count (desc) to prioritize main event
  const sortedEvents = [...events].sort((a, b) => b.attendeeCount - a.attendeeCount);

  // Remove dates from names
  const cleanedNames = sortedEvents.map(e => removeDateFromName(e.name));

  // Find shared prefix (minimum 2 words)
  const firstEvent = cleanedNames[0];
  if (!firstEvent) {
    // Fallback if no events (shouldn't happen)
    return `Merged Event - ${format(eventDate, "EEEE, MMMM d, yyyy")}`;
  }

  const words = firstEvent.split(/\s+/);
  let sharedWordCount = 0;

  for (let i = 0; i < words.length; i++) {
    const prefix = words.slice(0, i + 1).join(" ").toLowerCase();
    const allMatch = cleanedNames.every(name =>
      name.toLowerCase().startsWith(prefix)
    );

    if (allMatch) {
      sharedWordCount = i + 1;
    } else {
      break;
    }
  }

  // Require minimum 2 shared words
  if (sharedWordCount < 2) {
    sharedWordCount = Math.min(2, words.length);
  }

  const sharedPrefix = words.slice(0, sharedWordCount).join(" ");

  // Extract differences
  const differences = cleanedNames
    .map(name => name.substring(sharedPrefix.length).trim())
    .filter(diff => diff.length > 0);

  // Format date
  const formattedDate = format(eventDate, "EEEE, MMMM d, yyyy");

  // Build final name
  let finalName: string;
  if (differences.length === 0) {
    // No differences, use first event name
    finalName = `${sharedPrefix} - ${formattedDate}`;
  } else if (differences.length === 1) {
    finalName = `${sharedPrefix} ${differences[0]} - ${formattedDate}`;
  } else if (differences.length === 2) {
    finalName = `${sharedPrefix} ${differences[0]} and ${differences[1]} - ${formattedDate}`;
  } else {
    // 3+ events: use comma-separated with "and" before last
    const lastDiff = differences[differences.length - 1];
    const otherDiffs = differences.slice(0, -1).join(", ");
    finalName = `${sharedPrefix} ${otherDiffs} and ${lastDiff} - ${formattedDate}`;
  }

  // Truncate if exceeds database limit (255 chars)
  if (finalName.length > 255) {
    finalName = finalName.substring(0, 252) + "...";
  }

  return finalName;
}

/**
 * Find duplicate events based on:
 * - Same date (using SQL DATE() for timezone-safe comparison)
 * - Same first 2 words of name
 * - Only unmerged events with WooCommerce product IDs
 */
export async function findDuplicateEvents(): Promise<DuplicateEventGroup[]> {
  console.log("[merge-events] Finding duplicate events using SQL grouping...");

  // Use raw SQL for efficient, timezone-safe grouping
  const result = await db.execute<{
    event_day: Date;
    first_two_words: string;
    event_count: number;
    id: string;
    name: string;
    event_date: Date;
    woocommerce_product_id: string;
    created_at: Date;
    updated_at: Date;
    attendee_count: string;
  }>(sql`
    WITH event_analysis AS (
      SELECT
        e.id,
        e.name,
        e.event_date,
        e.woocommerce_product_id,
        e.created_at,
        e.updated_at,
        DATE(e.event_date) as event_day,
        SPLIT_PART(e.name, ' ', 1) || ' ' || SPLIT_PART(e.name, ' ', 2) as first_two_words,
        COUNT(a.id) as attendee_count
      FROM tablecn_events e
      LEFT JOIN tablecn_attendees a ON e.id = a.event_id
      WHERE e.woocommerce_product_id IS NOT NULL
        AND e.merged_into_event_id IS NULL
        AND LENGTH(TRIM(e.name)) > 0
      GROUP BY e.id, e.name, e.event_date, e.woocommerce_product_id, e.created_at, e.updated_at
    ),
    grouped AS (
      SELECT
        event_day,
        first_two_words,
        COUNT(*) as event_count
      FROM event_analysis
      WHERE LENGTH(TRIM(first_two_words)) >= 3
      GROUP BY event_day, first_two_words
      HAVING COUNT(*) >= 2
    )
    SELECT
      g.event_day,
      g.first_two_words,
      g.event_count,
      ea.id,
      ea.name,
      ea.event_date,
      ea.woocommerce_product_id,
      ea.created_at,
      ea.updated_at,
      ea.attendee_count
    FROM grouped g
    JOIN event_analysis ea
      ON g.event_day = DATE(ea.event_date)
      AND g.first_two_words = SPLIT_PART(ea.name, ' ', 1) || ' ' || SPLIT_PART(ea.name, ' ', 2)
    ORDER BY g.event_day DESC, ea.attendee_count DESC
  `);

  const rows = Array.from(result);
  console.log(`[merge-events] SQL query returned ${rows.length} event rows in duplicate groups`);

  // Process results and build DuplicateEventGroup objects
  const groupMap = new Map<string, DuplicateEventGroup>();

  for (const row of rows) {
    const groupKey = `${row.event_day}::${row.first_two_words}`;

    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, {
        date: new Date(row.event_date),
        events: [],
        sharedPrefix: row.first_two_words,
      });
    }

    groupMap.get(groupKey)!.events.push({
      id: row.id,
      name: row.name,
      eventDate: new Date(row.event_date),
      woocommerceProductId: row.woocommerce_product_id,
      mergedIntoEventId: null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      attendeeCount: parseInt(row.attendee_count || "0"),
    });
  }

  const duplicateGroups = Array.from(groupMap.values());

  // Detailed logging
  console.log(`[merge-events] Found ${duplicateGroups.length} duplicate groups:`);
  for (const group of duplicateGroups) {
    console.log(`  📅 ${group.sharedPrefix} (${format(group.date, 'yyyy-MM-dd')}): ${group.events.length} events`);
    for (const event of group.events) {
      console.log(`     • "${event.name}" (${event.attendeeCount} attendees, product ${event.woocommerceProductId})`);
    }
  }

  if (duplicateGroups.length === 0) {
    console.log(`[merge-events] ✓ No duplicate events found - all events are unique`);
  }

  return duplicateGroups;
}

/**
 * Merge a single duplicate event group
 */
export async function mergeEventGroup(group: DuplicateEventGroup): Promise<MergeResult> {
  const dateStr = format(group.date, "yyyy-MM-dd");
  console.log(`[merge-events] Merging group: ${group.sharedPrefix} on ${dateStr}`);

  try {
    // Sort events: most attendees first, then by product ID
    const sortedEvents = [...group.events].sort((a, b) => {
      if (b.attendeeCount !== a.attendeeCount) {
        return b.attendeeCount - a.attendeeCount;
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
    console.log(`[merge-events]     └─ ${primary.attendeeCount} attendees, product ${primary.woocommerceProductId}`);
    console.log(`[merge-events]   Secondary events (${secondaries.length}):`);
    secondaries.forEach(e => {
      console.log(`[merge-events]     └─ "${e.name}" (${e.attendeeCount} attendees, product ${e.woocommerceProductId})`);
    });

    // Create merged name
    const mergedName = createMergedEventName(group.events, group.date);
    console.log(`[merge-events]   📝 New merged name: "${mergedName}"`);

    let attendeesMoved = 0;
    const secondaryIds = secondaries.map(e => e.id);

    // Perform merge in transaction
    await db.transaction(async (tx) => {
      // 1. Get all attendees from secondary events
      const secondaryAttendees = await tx
        .select()
        .from(attendees)
        .where(inArray(attendees.eventId, secondaryIds));

      attendeesMoved = secondaryAttendees.length;

      console.log(`[merge-events]   👥 Moving ${secondaryAttendees.length} attendees to primary event`);

      // 2. Move attendees to primary event
      if (secondaryAttendees.length > 0) {
        await tx
          .update(attendees)
          .set({ eventId: primary.id })
          .where(inArray(attendees.eventId, secondaryIds));
      }

      // 3. Update primary event name
      await tx
        .update(events)
        .set({ name: mergedName })
        .where(eq(events.id, primary.id));

      // 4. Mark secondary events as merged (DO NOT DELETE)
      await tx
        .update(events)
        .set({ mergedIntoEventId: primary.id })
        .where(inArray(events.id, secondaryIds));
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
 */
export async function mergeDuplicateEvents(): Promise<BatchMergeResult> {
  console.log("[merge-events] Starting batch merge process...");
  const startTime = Date.now();

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
}
