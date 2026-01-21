/**
 * Disentangle Incorrectly Merged Events Script
 *
 * This script auto-detects events that were incorrectly merged and splits them back
 * into separate events based on their original WooCommerce product IDs.
 *
 * Auto-detection criteria for incorrect merges:
 * 1. Events with names containing patterns like "X and Y" where X and Y are distinct
 * 2. Events where attendees' sourceProductId values indicate multiple distinct products
 * 3. Events matching known problematic patterns (e.g., "Book Club" events that are different books)
 *
 * Run with: node scripts/disentangle-events.mjs [options]
 *
 * Options:
 *   --dry-run      Preview changes without making them
 *   --event-id=X   Only process a specific event ID
 *   --status       Show current progress status
 *   --reset        Clear saved progress and start fresh
 *
 * Supports pause/resume:
 *   Press Ctrl+C to pause. Run again to resume from where you left off.
 */

import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import postgres from "postgres";
import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import { format } from "date-fns";

// Load .env file from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, "..", ".env") });

// State file for pause/resume
const STATE_FILE = join(__dirname, ".disentangle-state.json");

const DATABASE_URL = process.env.DATABASE_URL ||
  "postgresql://neondb_owner:npg_sN5tMdouFOa6@ep-tiny-mode-a941wkv7-pooler.gwc.azure.neon.tech/neondb?sslmode=require";
const sql = postgres(DATABASE_URL);

// WooCommerce API client
const woocommerce = new WooCommerceRestApi.default({
  url: process.env.WOOCOMMERCE_URL || "https://www.kairos.london",
  consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
  consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
  version: "wc/v3",
  timeout: 30000,
});

// Rate limiting helper
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Graceful shutdown handling
let isShuttingDown = false;
let currentState = null;

function setupGracefulShutdown() {
  process.on("SIGINT", () => {
    if (isShuttingDown) {
      console.log("\n\nForce quitting...");
      process.exit(1);
    }
    isShuttingDown = true;
    console.log("\n\n⏸️  Pausing... (press Ctrl+C again to force quit)");
    console.log("   Finishing current operation...");
  });
}

/**
 * Load saved state from file
 */
function loadState() {
  if (existsSync(STATE_FILE)) {
    try {
      const data = readFileSync(STATE_FILE, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      console.error("Failed to load state file:", error.message);
      return null;
    }
  }
  return null;
}

/**
 * Save current state to file
 */
function saveState(state) {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error("Failed to save state:", error.message);
  }
}

/**
 * Clear saved state
 */
function clearState() {
  if (existsSync(STATE_FILE)) {
    unlinkSync(STATE_FILE);
    console.log("✓ Progress state cleared");
  } else {
    console.log("No saved state to clear");
  }
}

/**
 * Show current progress status
 */
async function showStatus() {
  const state = loadState();

  console.log("=========================================");
  console.log("  Disentangle Events - Status");
  console.log("=========================================\n");

  if (!state) {
    console.log("No saved progress found.");
    console.log("Run the script to start processing.\n");
    return;
  }

  console.log(`Started: ${new Date(state.startedAt).toLocaleString()}`);
  console.log(`Last update: ${new Date(state.lastUpdatedAt).toLocaleString()}`);
  console.log(`\nProgress: ${state.processedEventIds.length} / ${state.totalEvents} events`);
  console.log(`Success: ${state.success}`);
  console.log(`Failed: ${state.failed}`);
  console.log(`Skipped: ${state.skipped}`);

  const remaining = state.totalEvents - state.processedEventIds.length;
  if (remaining > 0) {
    console.log(`\nRemaining: ${remaining} events`);
    console.log("\nRun the script again to resume.");
  } else {
    console.log("\n✓ All events processed!");
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const SHOW_STATUS = args.includes("--status");
const RESET_STATE = args.includes("--reset");
const eventIdArg = args.find(a => a.startsWith("--event-id="));
const SPECIFIC_EVENT_ID = eventIdArg ? eventIdArg.split("=")[1] : null;

/**
 * Get product name from WooCommerce
 */
async function getProductName(productId) {
  try {
    const response = await woocommerce.get(`products/${productId}`);
    return response.data.name;
  } catch (error) {
    console.error(`Failed to fetch product ${productId}:`, error.message);
    return null;
  }
}

/**
 * Create a clean event name from product name and date
 */
function createCleanEventName(productName, eventDate) {
  // Remove any date patterns from the product name
  let cleanName = productName
    .replace(/\s*-?\s*\d{1,2}\/\d{1,2}\/\d{4}\s*$/, "")
    .replace(/\s*-?\s*\d{4}-\d{1,2}-\d{1,2}\s*$/, "")
    .replace(/\s*-?\s*\w+\s+\d{1,2},\s*\d{4}\s*$/, "")
    .replace(/\s*-?\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),.*$/i, "")
    .trim();

  // Format the event date
  const formattedDate = format(new Date(eventDate), "EEEE, MMMM d, yyyy");

  return `${cleanName} - ${formattedDate}`;
}

/**
 * Patterns that indicate distinct event types that should NOT be merged
 * even if they share date and first words
 */
const DISTINCT_EVENT_PATTERNS = [
  // Book Club - different books are different events
  {
    namePattern: /book\s*club/i,
    reason: "Book Club events for different books should be separate"
  },
  // Members-only variants - these ARE correct to merge
  // { namePattern: /members/i, reason: "Members variant" }
];

/**
 * Check if an event name has been corrupted by repeated merge operations
 * (e.g., "Event - Wednesday, - Wednesday, - Wednesday, ...")
 */
function detectCorruptedEventName(eventName) {
  // Pattern: repeated day names or date fragments
  const repeatedDayPattern = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*-?\s*\1/i;
  const repeatedDatePattern = /- [A-Za-z]+,\s*-\s*[A-Za-z]+,/;

  if (repeatedDayPattern.test(eventName) || repeatedDatePattern.test(eventName)) {
    return {
      isCorrupted: true,
      reason: "Event name contains repeated date patterns from merge bug"
    };
  }

  return { isCorrupted: false };
}

/**
 * Check if an event name suggests it was incorrectly merged
 * Returns true if the name contains "X and Y" pattern with distinctly different variations
 */
function detectIncorrectMergeFromName(eventName) {
  // First check for name corruption
  const corruption = detectCorruptedEventName(eventName);
  if (corruption.isCorrupted) {
    return {
      isIncorrect: true,
      isCorrupted: true,
      reason: corruption.reason
    };
  }

  // Skip if "and" is part of a book title (common pattern: "X and Y" by Author)
  // This catches cases like "Eco-Miserabilism and Radical Hope" which is ONE book
  const bookTitleAndPattern = /"[^"]*\band\b[^"]*"\s+by/i;
  if (bookTitleAndPattern.test(eventName)) {
    return { isIncorrect: false, reason: "Single book title containing 'and'" };
  }

  // Skip if "and" appears after "as told to" (author collaboration)
  if (/as told to .* and /i.test(eventName)) {
    return { isIncorrect: false, reason: "Author collaboration" };
  }

  // Pattern for clearly merged events: "Event Type: X and Y - Date"
  // where X and Y are distinctly different items
  // This pattern looks for: "EventType and AnotherEvent - Date"
  const mergedEventPattern = /^(.+?)\s*-\s*[A-Za-z]+,.*\s+and\s+.+\s*-\s*[A-Za-z]+,/i;

  if (mergedEventPattern.test(eventName)) {
    // This looks like two events merged together (both have date suffixes)
    return {
      isIncorrect: true,
      reason: "Two distinct events with dates were merged together"
    };
  }

  // Check for Book Club specific pattern where different books are merged
  // Pattern: Book Club: "Book A" ... and "Book B" ...
  const twoBooksMergedPattern = /book\s*club.*"[^"]+"\s*.*\s+and\s+.*"[^"]+"/i;
  if (twoBooksMergedPattern.test(eventName)) {
    // This is two different books merged - incorrect
    return {
      isIncorrect: true,
      reason: "Book Club events for different books were merged"
    };
  }

  // Check for video/event merger pattern
  // "Video: Speaker A on Topic and Speaker B on Topic - Date"
  const multiSpeakerMergePattern = /:\s*.+\s+on\s+.+\s+and\s+.+\s+on\s+/i;
  if (multiSpeakerMergePattern.test(eventName) && !eventName.includes("Members")) {
    return {
      isIncorrect: true,
      reason: "Multiple speaker events were merged"
    };
  }

  return { isIncorrect: false };
}

/**
 * Find all potentially incorrectly merged events
 */
async function findIncorrectlyMergedEvents() {
  console.log("🔍 Scanning for incorrectly merged events...\n");

  // Get all events that look like they were merged (have "and" in name)
  const events = await sql`
    SELECT
      e.id,
      e.name,
      e.event_date,
      e.woocommerce_product_id,
      e.merged_product_ids,
      e.created_at,
      COUNT(a.id) as attendee_count
    FROM tablecn_events e
    LEFT JOIN tablecn_attendees a ON e.id = a.event_id
    WHERE e.merged_into_event_id IS NULL
    ${SPECIFIC_EVENT_ID ? sql`AND e.id = ${SPECIFIC_EVENT_ID}` : sql``}
    GROUP BY e.id
    ORDER BY e.event_date DESC
  `;

  const incorrectMerges = [];

  for (const event of events) {
    const detection = detectIncorrectMergeFromName(event.name);

    if (detection.isIncorrect) {
      // Check if we have attendees from multiple source products
      const sourceProducts = await sql`
        SELECT DISTINCT source_product_id
        FROM tablecn_attendees
        WHERE event_id = ${event.id}
        AND source_product_id IS NOT NULL
      `;

      incorrectMerges.push({
        event,
        detection,
        sourceProductIds: sourceProducts.map(r => r.source_product_id),
        hasMultipleSources: sourceProducts.length > 1
      });
    }
  }

  return incorrectMerges;
}

/**
 * Disentangle a single incorrectly merged event
 * This is complex because we need to:
 * 1. Create new events for each variation
 * 2. Move attendees based on their sourceProductId
 * 3. Update the original event
 */
async function disentangleEvent(mergeInfo) {
  const { event, detection, sourceProductIds } = mergeInfo;

  console.log(`\n📋 Processing: "${event.name}"`);
  console.log(`   Date: ${new Date(event.event_date).toLocaleDateString()}`);
  console.log(`   Attendees: ${event.attendee_count}`);
  console.log(`   Reason: ${detection.reason}`);
  console.log(`   Variations detected: ${detection.variations?.join(", ") || "unknown"}`);
  console.log(`   Source products in attendees: ${sourceProductIds.length > 0 ? sourceProductIds.join(", ") : "none tracked"}`);

  if (DRY_RUN) {
    console.log("   ⚠️  DRY RUN - No changes will be made");
    return { success: true, dryRun: true };
  }

  // If we don't have source product IDs, we can't reliably disentangle
  if (sourceProductIds.length < 2) {
    console.log("   ❌ Cannot disentangle: No source product tracking available");
    console.log("      Attendees would need sourceProductId to determine which event they belong to");
    return { success: false, reason: "No source product tracking" };
  }

  try {
    // Group attendees by source product
    const attendeesByProduct = await sql`
      SELECT
        source_product_id,
        COUNT(*) as count,
        array_agg(id) as attendee_ids
      FROM tablecn_attendees
      WHERE event_id = ${event.id}
      AND source_product_id IS NOT NULL
      GROUP BY source_product_id
    `;

    console.log(`   Found ${attendeesByProduct.length} distinct source products`);

    // The largest group keeps the original event
    // Smaller groups get new events created
    const sortedGroups = [...attendeesByProduct].sort((a, b) => b.count - a.count);
    const primaryGroup = sortedGroups[0];
    const secondaryGroups = sortedGroups.slice(1);

    console.log(`   Primary group (keeps original): product ${primaryGroup.source_product_id} with ${primaryGroup.count} attendees`);

    // First, get proper names from WooCommerce for all products
    console.log(`   Fetching product names from WooCommerce...`);
    const productNames = new Map();

    for (const group of [primaryGroup, ...secondaryGroups]) {
      const productName = await getProductName(group.source_product_id);
      if (productName) {
        productNames.set(group.source_product_id, productName);
        console.log(`     Product ${group.source_product_id}: "${productName}"`);
      } else {
        console.log(`     Product ${group.source_product_id}: [fetch failed]`);
      }
      await delay(500); // Rate limiting
    }

    // Create new events for secondary groups
    for (const group of secondaryGroups) {
      console.log(`   Creating new event for: product ${group.source_product_id} with ${group.count} attendees`);

      // Get the proper name from WooCommerce or use fallback
      const productName = productNames.get(group.source_product_id);
      const newEventName = productName
        ? createCleanEventName(productName, event.event_date)
        : `Disentangled Event (Product ${group.source_product_id}) - ${format(new Date(event.event_date), "EEEE, MMMM d, yyyy")}`;

      // Create new event
      const newEvent = await sql`
        INSERT INTO tablecn_events (
          id, name, event_date, woocommerce_product_id, created_at, updated_at
        ) VALUES (
          gen_random_uuid()::text,
          ${newEventName},
          ${event.event_date},
          ${group.source_product_id},
          NOW(),
          NOW()
        )
        RETURNING id, name
      `;

      console.log(`   ✅ Created new event: ${newEvent[0].id}`);
      console.log(`      Name: "${newEventName}"`);

      // Move attendees to new event
      await sql`
        UPDATE tablecn_attendees
        SET event_id = ${newEvent[0].id}
        WHERE id = ANY(${group.attendee_ids})
      `;

      console.log(`   ✅ Moved ${group.count} attendees to new event`);
    }

    // Update original event with proper name from WooCommerce
    const primaryProductName = productNames.get(primaryGroup.source_product_id);
    const cleanedName = primaryProductName
      ? createCleanEventName(primaryProductName, event.event_date)
      : event.name; // Keep original if can't fetch

    if (primaryProductName) {
      await sql`
        UPDATE tablecn_events
        SET
          name = ${cleanedName},
          woocommerce_product_id = ${primaryGroup.source_product_id}
        WHERE id = ${event.id}
      `;
      console.log(`   ✅ Updated original event name to: "${cleanedName}"`);
    } else {
      console.log(`   ⚠️  Could not fetch product name, keeping original event name`);
    }

    return { success: true, eventsCreated: secondaryGroups.length };
  } catch (error) {
    console.error(`   ❌ Error disentangling event:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Main function
 */
async function main() {
  setupGracefulShutdown();

  // Handle special commands
  if (SHOW_STATUS) {
    await showStatus();
    await sql.end();
    return;
  }

  if (RESET_STATE) {
    clearState();
    await sql.end();
    return;
  }

  console.log("=========================================");
  console.log("  Event Disentanglement Script");
  console.log("=========================================");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (preview only)" : "LIVE (will make changes)"}`);
  if (SPECIFIC_EVENT_ID) {
    console.log(`Target: Event ID ${SPECIFIC_EVENT_ID}`);
  }
  console.log("");

  try {
    const incorrectMerges = await findIncorrectlyMergedEvents();

    console.log(`\n📊 Found ${incorrectMerges.length} potentially incorrectly merged events:\n`);

    if (incorrectMerges.length === 0) {
      console.log("✅ No incorrectly merged events detected!");
      process.exit(0);
    }

    // Load or initialize state
    let state = loadState();
    const isResuming = state !== null && state.processedEventIds?.length > 0;

    if (isResuming) {
      console.log(`📂 Resuming from previous run...`);
      console.log(`   Already processed: ${state.processedEventIds.length} events`);
      console.log(`   Success: ${state.success}, Failed: ${state.failed}, Skipped: ${state.skipped}\n`);
    } else {
      state = {
        startedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        totalEvents: incorrectMerges.length,
        processedEventIds: [],
        success: 0,
        failed: 0,
        skipped: 0,
      };
    }

    currentState = state;

    // Filter out already processed events
    const eventsToProcess = incorrectMerges.filter(
      m => !state.processedEventIds.includes(m.event.id)
    );

    if (eventsToProcess.length === 0) {
      console.log("✅ All events have been processed!");
      clearState();
      await sql.end();
      return;
    }

    // List all detected issues (only unprocessed)
    for (const merge of eventsToProcess) {
      console.log(`• "${merge.event.name}"`);
      console.log(`  - ${merge.detection.reason}`);
      console.log(`  - Has multiple source products: ${merge.hasMultipleSources ? "Yes" : "No"}`);
    }

    console.log("\n--- Processing ---\n");

    for (const merge of eventsToProcess) {
      // Check for shutdown signal
      if (isShuttingDown) {
        console.log("\n   ✓ Progress saved. Run again to resume.\n");
        break;
      }

      const result = await disentangleEvent(merge);

      if (result.dryRun) {
        state.skipped++;
      } else if (result.success) {
        state.success++;
      } else {
        state.failed++;
      }

      // Mark as processed and save state
      state.processedEventIds.push(merge.event.id);
      state.lastUpdatedAt = new Date().toISOString();
      saveState(state);
    }

    console.log("\n=========================================");
    console.log("  Summary");
    console.log("=========================================");
    console.log(`Total detected: ${incorrectMerges.length}`);

    if (DRY_RUN) {
      console.log(`Would process: ${eventsToProcess.length} events`);
      console.log("\nRun without --dry-run to apply changes");
    } else {
      console.log(`Successful: ${state.success}`);
      console.log(`Failed: ${state.failed}`);
      console.log(`Skipped: ${state.skipped}`);

      const remaining = incorrectMerges.length - state.processedEventIds.length;
      if (remaining > 0) {
        console.log(`Remaining: ${remaining}`);
        console.log("\nRun the script again to continue.");
      } else {
        // All done - clear state file
        clearState();
        console.log("\n✓ All events processed!");
      }
    }

  } catch (error) {
    console.error("Fatal error:", error);
    if (currentState) {
      saveState(currentState);
      console.log("Progress saved. Run again to resume.");
    }
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
