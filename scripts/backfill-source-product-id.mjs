/**
 * Backfill source_product_id for existing attendees
 *
 * This script populates the source_product_id field by:
 * 1. PRIORITY: Querying WooCommerce for attendees in corrupted/merged events
 * 2. BATCH: For clean events, setting source_product_id = event.woocommerceProductId
 *
 * PAUSE/RESUME: The script saves progress to a state file. If interrupted (Ctrl+C),
 * it will resume from where it left off on the next run.
 *
 * Run with: node scripts/backfill-source-product-id.mjs [options]
 *
 * Options:
 *   --priority-only   Only process corrupted events (WooCommerce queries)
 *   --batch-only      Only batch update clean events (no WooCommerce queries)
 *   --dry-run         Preview changes without making them
 *   --reset           Clear saved progress and start fresh
 *   --status          Show current progress status and exit
 */

import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import postgres from "postgres";
import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";

// Load .env file from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, "..", ".env") });

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const PRIORITY_ONLY = args.includes("--priority-only");
const BATCH_ONLY = args.includes("--batch-only");
const RESET = args.includes("--reset");
const STATUS_ONLY = args.includes("--status");

// State file for pause/resume
const STATE_FILE = join(__dirname, ".backfill-state.json");

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

// Corrupted event IDs from our investigation
const CORRUPTED_EVENT_IDS = [
  "NLLSbFg1coZc", // Book Club merge (0 attendees)
  "xwxsm3GIIxDj", // Book Club merge (10 attendees)
  "unvURy8sT47K", // Repeated day name
  "SSIt2ihLMKXf", // Repeated day name
  "R5u2MGf4CbH3", // Repeated day name
  "fh6qEZ2nOezG", // Repeated day name
  "hT8v2gDVCwct", // Repeated day name
  "m0cisopDj89w", // Repeated day name
  "NuSC6zMkqU3i", // Repeated day name
  "LuLHgBnkoyXc", // Artivism merge
];

/**
 * State management for pause/resume
 */
function loadState() {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    } catch (e) {
      console.warn("Could not load state file, starting fresh");
    }
  }
  return {
    priorityProcessedOrders: [],
    priorityComplete: false,
    batchProcessedEvents: [],
    batchComplete: false,
    lastUpdated: null,
  };
}

function saveState(state) {
  state.lastUpdated = new Date().toISOString();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function clearState() {
  if (existsSync(STATE_FILE)) {
    unlinkSync(STATE_FILE);
    console.log("✓ Progress state cleared");
  }
}

// Graceful shutdown handler
let isShuttingDown = false;
let currentState = null;

function setupGracefulShutdown() {
  process.on("SIGINT", () => {
    if (isShuttingDown) {
      console.log("\nForce quitting...");
      process.exit(1);
    }
    isShuttingDown = true;
    console.log("\n\n⏸️  Pausing... (press Ctrl+C again to force quit)");
    console.log("   Progress is being saved...");
    if (currentState) {
      saveState(currentState);
      console.log("   ✓ Progress saved. Run the script again to resume.");
    }
  });
}

/**
 * Get product ID from WooCommerce order
 */
async function getProductIdFromOrder(orderId) {
  try {
    const response = await woocommerce.get(`orders/${orderId}`);
    const order = response.data;

    // Get the first line item's product ID
    const lineItem = order.line_items?.[0];
    if (lineItem) {
      return {
        productId: lineItem.product_id?.toString(),
        orderStatus: order.status,
        orderDate: order.date_created,
      };
    }
    return null;
  } catch (error) {
    console.error(`Failed to fetch order ${orderId}:`, error.message);
    return null;
  }
}

/**
 * Process corrupted events - query WooCommerce for accurate product IDs
 */
async function processPriorityEvents(state) {
  console.log("\n🚨 PRIORITY: Processing corrupted events...\n");

  if (state.priorityComplete) {
    console.log("✓ Priority processing already complete (from previous run)");
    return { processed: 0, updated: 0, failed: 0, skipped: 0 };
  }

  // Get attendees from corrupted events
  const attendees = await sql`
    SELECT a.id, a.email, a.woocommerce_order_id, a.event_id, e.name as event_name
    FROM tablecn_attendees a
    JOIN tablecn_events e ON a.event_id = e.id
    WHERE a.event_id = ANY(${CORRUPTED_EVENT_IDS})
      AND a.source_product_id IS NULL
      AND a.woocommerce_order_id IS NOT NULL
    ORDER BY a.event_id
  `;

  console.log(`Found ${attendees.length} attendees in corrupted events to process`);

  if (attendees.length === 0) {
    console.log("✓ No attendees need processing in corrupted events");
    state.priorityComplete = true;
    saveState(state);
    return { processed: 0, updated: 0, failed: 0, skipped: 0 };
  }

  // Group by order ID to minimize API calls
  const orderIds = [...new Set(attendees.map(a => a.woocommerce_order_id))];
  const pendingOrderIds = orderIds.filter(id => !state.priorityProcessedOrders.includes(id));

  console.log(`Total orders: ${orderIds.length}, Already processed: ${state.priorityProcessedOrders.length}, Remaining: ${pendingOrderIds.length}`);

  if (pendingOrderIds.length === 0) {
    console.log("✓ All orders already processed");
    state.priorityComplete = true;
    saveState(state);
    return { processed: 0, updated: 0, failed: 0, skipped: orderIds.length };
  }

  let processed = 0;
  let updated = 0;
  let failed = 0;
  let skipped = state.priorityProcessedOrders.length;

  const orderProductMap = new Map();

  for (const orderId of pendingOrderIds) {
    if (isShuttingDown) {
      console.log("\n⏸️  Stopping at safe point...");
      break;
    }

    console.log(`  [${processed + skipped + 1}/${orderIds.length}] Fetching order ${orderId}...`);

    const result = await getProductIdFromOrder(orderId);
    if (result) {
      orderProductMap.set(orderId, result);
      console.log(`    ✓ Product ID: ${result.productId}, Status: ${result.orderStatus}`);
    } else {
      console.log(`    ✗ Failed to fetch order`);
      failed++;
    }

    // Mark as processed
    state.priorityProcessedOrders.push(orderId);
    processed++;

    // Save state periodically (every 5 orders)
    if (processed % 5 === 0) {
      saveState(state);
    }

    // Rate limiting: wait 500ms between requests
    await delay(500);
  }

  // Save final state
  saveState(state);

  if (isShuttingDown) {
    return { processed, updated, failed, skipped, paused: true };
  }

  // Update attendees with fetched product IDs
  console.log(`\nUpdating attendees with fetched product IDs...`);

  for (const attendee of attendees) {
    const orderData = orderProductMap.get(attendee.woocommerce_order_id);
    if (!orderData) continue;

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would update ${attendee.email}: source_product_id = ${orderData.productId}`);
      updated++;
    } else {
      try {
        await sql`
          UPDATE tablecn_attendees
          SET
            source_product_id = ${orderData.productId},
            order_status = ${orderData.orderStatus},
            woocommerce_order_date = ${orderData.orderDate}
          WHERE id = ${attendee.id}
        `;
        updated++;
      } catch (error) {
        console.error(`  Failed to update ${attendee.email}:`, error.message);
        failed++;
      }
    }
  }

  state.priorityComplete = true;
  saveState(state);

  return { processed, updated, failed, skipped };
}

/**
 * Batch update clean events - set source_product_id from event's woocommerceProductId
 */
async function batchUpdateCleanEvents(state) {
  console.log("\n📦 BATCH: Updating clean events...\n");

  if (state.batchComplete) {
    console.log("✓ Batch processing already complete (from previous run)");
    return { events: 0, attendees: 0, skipped: 0 };
  }

  // Find all events that need updating
  const allEvents = await sql`
    SELECT
      e.id as event_id,
      e.name as event_name,
      e.woocommerce_product_id,
      COUNT(a.id) as attendee_count
    FROM tablecn_events e
    JOIN tablecn_attendees a ON e.id = a.event_id
    WHERE a.source_product_id IS NULL
      AND e.woocommerce_product_id IS NOT NULL
      AND e.id != ALL(${CORRUPTED_EVENT_IDS})
    GROUP BY e.id, e.name, e.woocommerce_product_id
    ORDER BY attendee_count DESC
  `;

  const pendingEvents = allEvents.filter(e => !state.batchProcessedEvents.includes(e.event_id));
  const totalAttendees = pendingEvents.reduce((sum, e) => sum + parseInt(e.attendee_count), 0);

  console.log(`Total events: ${allEvents.length}, Already processed: ${state.batchProcessedEvents.length}, Remaining: ${pendingEvents.length}`);
  console.log(`Attendees to update: ${totalAttendees}`);

  if (pendingEvents.length === 0) {
    console.log("✓ All clean events already have source_product_id set");
    state.batchComplete = true;
    saveState(state);
    return { events: 0, attendees: 0, skipped: state.batchProcessedEvents.length };
  }

  let eventsProcessed = 0;
  let attendeesUpdated = 0;
  let skipped = state.batchProcessedEvents.length;

  for (const event of pendingEvents) {
    if (isShuttingDown) {
      console.log("\n⏸️  Stopping at safe point...");
      break;
    }

    console.log(`  [${eventsProcessed + skipped + 1}/${allEvents.length}] Updating ${event.attendee_count} attendees for: ${event.event_name.substring(0, 50)}...`);

    if (DRY_RUN) {
      console.log(`    [DRY RUN] Would set source_product_id = ${event.woocommerce_product_id}`);
      attendeesUpdated += parseInt(event.attendee_count);
    } else {
      try {
        await sql`
          UPDATE tablecn_attendees
          SET source_product_id = ${event.woocommerce_product_id}
          WHERE event_id = ${event.event_id}
            AND source_product_id IS NULL
        `;
        attendeesUpdated += parseInt(event.attendee_count);
        console.log(`    ✓ Updated`);
      } catch (error) {
        console.error(`    ✗ Failed:`, error.message);
      }
    }

    // Mark as processed
    state.batchProcessedEvents.push(event.event_id);
    eventsProcessed++;

    // Save state periodically (every 10 events)
    if (eventsProcessed % 10 === 0) {
      saveState(state);
    }
  }

  // Save final state
  if (!isShuttingDown) {
    state.batchComplete = true;
  }
  saveState(state);

  return { events: eventsProcessed, attendees: attendeesUpdated, skipped, paused: isShuttingDown };
}

/**
 * Show current status
 */
async function showStatus() {
  const stats = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(source_product_id) as with_source,
      COUNT(*) - COUNT(source_product_id) as without_source
    FROM tablecn_attendees
  `;

  const corruptedStats = await sql`
    SELECT COUNT(*) as count
    FROM tablecn_attendees
    WHERE event_id = ANY(${CORRUPTED_EVENT_IDS})
      AND source_product_id IS NULL
  `;

  console.log("\n📊 Database Status:");
  console.log(`  Total attendees: ${stats[0].total}`);
  console.log(`  With source_product_id: ${stats[0].with_source}`);
  console.log(`  Without source_product_id: ${stats[0].without_source}`);
  console.log(`  In corrupted events (need WooCommerce query): ${corruptedStats[0].count}`);

  const state = loadState();
  console.log("\n📁 Saved Progress:");
  if (state.lastUpdated) {
    console.log(`  Last updated: ${state.lastUpdated}`);
    console.log(`  Priority orders processed: ${state.priorityProcessedOrders.length}`);
    console.log(`  Priority complete: ${state.priorityComplete}`);
    console.log(`  Batch events processed: ${state.batchProcessedEvents.length}`);
    console.log(`  Batch complete: ${state.batchComplete}`);
  } else {
    console.log(`  No saved progress (fresh start)`);
  }
}

/**
 * Main function
 */
async function main() {
  console.log("=========================================");
  console.log("  Backfill source_product_id Script");
  console.log("=========================================");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (preview only)" : "LIVE (will make changes)"}`);
  console.log(`Priority only: ${PRIORITY_ONLY}`);
  console.log(`Batch only: ${BATCH_ONLY}`);
  console.log("");
  console.log("💡 Tip: Press Ctrl+C to pause. Progress is automatically saved.");
  console.log("");

  setupGracefulShutdown();

  try {
    // Handle special commands
    if (RESET) {
      clearState();
      await showStatus();
      return;
    }

    if (STATUS_ONLY) {
      await showStatus();
      return;
    }

    await showStatus();

    // Load or initialize state
    currentState = loadState();

    let priorityResult = { processed: 0, updated: 0, failed: 0, skipped: 0 };
    let batchResult = { events: 0, attendees: 0, skipped: 0 };

    // Process priority events (corrupted) unless --batch-only
    if (!BATCH_ONLY && !isShuttingDown) {
      priorityResult = await processPriorityEvents(currentState);
    }

    // Process clean events unless --priority-only
    if (!PRIORITY_ONLY && !isShuttingDown) {
      batchResult = await batchUpdateCleanEvents(currentState);
    }

    // Show final status
    await showStatus();

    console.log("\n=========================================");
    console.log("  Summary");
    console.log("=========================================");

    if (!BATCH_ONLY) {
      console.log(`Priority (corrupted events):`);
      console.log(`  Orders queried: ${priorityResult.processed}`);
      console.log(`  Attendees updated: ${priorityResult.updated}`);
      console.log(`  Failed: ${priorityResult.failed}`);
      console.log(`  Skipped (already done): ${priorityResult.skipped}`);
    }

    if (!PRIORITY_ONLY) {
      console.log(`Batch (clean events):`);
      console.log(`  Events processed: ${batchResult.events}`);
      console.log(`  Attendees updated: ${batchResult.attendees}`);
      console.log(`  Skipped (already done): ${batchResult.skipped}`);
    }

    if (DRY_RUN) {
      console.log("\n⚠️  This was a dry run. Run without --dry-run to apply changes.");
    }

    if (priorityResult.paused || batchResult.paused) {
      console.log("\n⏸️  Script was paused. Run again to resume from where you left off.");
    }

  } catch (error) {
    console.error("Fatal error:", error);
    if (currentState) {
      saveState(currentState);
      console.log("Progress saved before exit.");
    }
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
