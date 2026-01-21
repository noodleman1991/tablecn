/**
 * Fix Corrupted Event Names Script
 *
 * This script fixes events with corrupted names (repeated day patterns)
 * by fetching the correct name from WooCommerce.
 *
 * Corrupted patterns:
 * - "Event Name - Wednesday, - Wednesday, - Wednesday, ..."
 * - "Event Name (Copy) and (Copy) - Thursday, - Thursday, ..."
 *
 * Run with: node scripts/fix-corrupted-names.mjs [options]
 *
 * Options:
 *   --dry-run    Preview changes without making them
 *   --status     Show current progress status
 *   --reset      Clear saved progress and start fresh
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
const STATE_FILE = join(__dirname, ".fix-names-state.json");

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const SHOW_STATUS = args.includes("--status");
const RESET_STATE = args.includes("--reset");

// Database connection
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
  console.log("  Fix Corrupted Names - Status");
  console.log("=========================================\n");

  if (!state) {
    console.log("No saved progress found.");
    console.log("Run the script to start processing.\n");
    return;
  }

  console.log(`Started: ${new Date(state.startedAt).toLocaleString()}`);
  console.log(`Last update: ${new Date(state.lastUpdatedAt).toLocaleString()}`);
  console.log(`\nProgress: ${state.processedEventIds.length} / ${state.totalEvents} events`);
  console.log(`Fixed: ${state.fixed}`);
  console.log(`Failed: ${state.failed}`);

  const remaining = state.totalEvents - state.processedEventIds.length;
  if (remaining > 0) {
    console.log(`\nRemaining: ${remaining} events`);
    console.log("\nRun the script again to resume.");
  } else {
    console.log("\n✓ All events processed!");
  }
}

/**
 * Detect if an event name is corrupted
 */
function isCorruptedName(name) {
  // Repeated day patterns
  const repeatedDayPattern = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*-\s*\1/i;
  // Repeated date fragments
  const repeatedDatePattern = /- [A-Za-z]+,\s*-\s*[A-Za-z]+,/;
  // Copy patterns that got merged
  const copyMergePattern = /\(Copy\)\s*and\s*\(Copy\)/i;

  return (
    repeatedDayPattern.test(name) ||
    repeatedDatePattern.test(name) ||
    copyMergePattern.test(name)
  );
}

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
 * Create a clean event name from WooCommerce product name and event date
 */
function createCleanEventName(productName, eventDate) {
  // Remove any date patterns that might be in the product name
  let cleanName = productName
    .replace(/\s*-?\s*\d{1,2}\/\d{1,2}\/\d{4}\s*$/, "") // DD/MM/YYYY
    .replace(/\s*-?\s*\d{4}-\d{1,2}-\d{1,2}\s*$/, "") // YYYY-MM-DD
    .replace(/\s*-?\s*\w+\s+\d{1,2},\s*\d{4}\s*$/, "") // Month DD, YYYY
    .replace(/\s*-?\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),.*$/i, "") // Day, Date
    .trim();

  // Format the event date nicely
  const formattedDate = format(new Date(eventDate), "EEEE, MMMM d, yyyy");

  return `${cleanName} - ${formattedDate}`;
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
  console.log("  Fix Corrupted Event Names Script");
  console.log("=========================================");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (preview only)" : "LIVE (will make changes)"}`);
  console.log("");

  try {
    // Find events with corrupted names
    console.log("🔍 Scanning for events with corrupted names...\n");

    const allEvents = await sql`
      SELECT id, name, event_date, woocommerce_product_id
      FROM tablecn_events
      WHERE woocommerce_product_id IS NOT NULL
        AND merged_into_event_id IS NULL
      ORDER BY event_date DESC
    `;

    const corruptedEvents = allEvents.filter(e => isCorruptedName(e.name));

    console.log(`Found ${corruptedEvents.length} events with corrupted names.\n`);

    if (corruptedEvents.length === 0) {
      console.log("✓ No corrupted event names found!");
      return;
    }

    // Load or initialize state
    let state = loadState();
    const isResuming = state !== null && state.processedEventIds?.length > 0;

    if (isResuming) {
      console.log(`📂 Resuming from previous run...`);
      console.log(`   Already processed: ${state.processedEventIds.length} events`);
      console.log(`   Fixed: ${state.fixed}, Failed: ${state.failed}\n`);
    } else {
      state = {
        startedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        totalEvents: corruptedEvents.length,
        processedEventIds: [],
        fixed: 0,
        failed: 0,
      };
    }

    currentState = state;

    // Filter out already processed events
    const eventsToProcess = corruptedEvents.filter(
      e => !state.processedEventIds.includes(e.id)
    );

    if (eventsToProcess.length === 0) {
      console.log("✓ All corrupted events have been processed!");
      clearState();
      return;
    }

    console.log(`Events to process: ${eventsToProcess.length}\n`);

    // List corrupted events (only unprocessed ones)
    for (const event of eventsToProcess) {
      console.log(`• Event ID: ${event.id}`);
      console.log(`  Current name: ${event.name.substring(0, 100)}...`);
      console.log(`  Product ID: ${event.woocommerce_product_id}`);
      console.log(`  Date: ${new Date(event.event_date).toDateString()}`);
      console.log("");
    }

    // Process each corrupted event
    console.log("\n🔧 Fetching correct names from WooCommerce...\n");

    for (const event of eventsToProcess) {
      // Check for shutdown signal
      if (isShuttingDown) {
        console.log("\n   ✓ Progress saved. Run again to resume.\n");
        break;
      }

      console.log(`Processing: ${event.id} (Product ${event.woocommerce_product_id})`);

      // Get the correct product name from WooCommerce
      const productName = await getProductName(event.woocommerce_product_id);

      if (!productName) {
        console.log(`  ✗ Failed to fetch product name`);
        state.failed++;
        state.processedEventIds.push(event.id);
        state.lastUpdatedAt = new Date().toISOString();
        saveState(state);
        await delay(500);
        continue;
      }

      // Create clean event name
      const cleanName = createCleanEventName(productName, event.event_date);

      console.log(`  WooCommerce name: ${productName}`);
      console.log(`  New event name: ${cleanName}`);

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would update event name`);
        state.fixed++;
      } else {
        try {
          await sql`
            UPDATE tablecn_events
            SET name = ${cleanName}
            WHERE id = ${event.id}
          `;
          console.log(`  ✓ Updated event name`);
          state.fixed++;
        } catch (error) {
          console.error(`  ✗ Failed to update:`, error.message);
          state.failed++;
        }
      }

      // Mark as processed and save state
      state.processedEventIds.push(event.id);
      state.lastUpdatedAt = new Date().toISOString();
      saveState(state);

      console.log("");

      // Rate limiting
      await delay(500);
    }

    console.log("\n=========================================");
    console.log("  Summary");
    console.log("=========================================");
    console.log(`Total corrupted: ${corruptedEvents.length}`);
    console.log(`Fixed: ${state.fixed}`);
    console.log(`Failed: ${state.failed}`);

    const remaining = corruptedEvents.length - state.processedEventIds.length;
    if (remaining > 0) {
      console.log(`Remaining: ${remaining}`);
      console.log("\nRun the script again to continue.");
    } else {
      // All done - clear state file
      clearState();
      console.log("\n✓ All events processed!");
    }

    if (DRY_RUN) {
      console.log("\n⚠️  This was a dry run. Run without --dry-run to apply changes.");
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
