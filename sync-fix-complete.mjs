#!/usr/bin/env node
/**
 * COMPREHENSIVE WOOCOMMERCE SYNC FIX
 *
 * ROOT CAUSE: MJS scripts use `uid` as ticketId, but TypeScript uses actual WooCommerce ticket ID
 * This creates duplicate/wrong data in database
 *
 * SOLUTION:
 * 1. Extract ticket IDs correctly (look for _ticket_id_for_{uid} in meta)
 * 2. Clean mode: Delete ALL existing tickets for event, resync fresh
 * 3. Validate against WooCommerce after each event
 * 4. Detailed logging for every operation
 *
 * SAFETY:
 * - Backup data before deletion
 * - Transaction-based (rollback on failure)
 * - Pause/resume capability
 * - Dry-run mode available
 */

import { createRequire } from 'module';
import pg from 'pg';
import { customAlphabet } from 'nanoid';
import fs from 'fs';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const { Pool } = pg;

// ID generator
const generateId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  12
);

// WooCommerce API setup
const WooCommerceRestApi = require('@woocommerce/woocommerce-rest-api').default;

const woocommerce = new WooCommerceRestApi({
  url: process.env.WOOCOMMERCE_URL,
  consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
  consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
  version: 'wc/v3',
});

// Configuration
const DRY_RUN = process.argv.includes('--dry-run');
const CLEAN_MODE = process.argv.includes('--clean'); // Delete all tickets and resync
const START_FROM = parseInt(process.argv.find(arg => arg.startsWith('--start='))?.split('=')[1]) || 1;

// Global pause flag
let shouldPause = false;
let lastProcessedEvent = 0;

// Backup file for deleted records
const backupFile = `sync-fix-backup-${new Date().toISOString().replace(/:/g, '-')}.json`;
const deletedRecords = [];

console.log('🔧 COMPREHENSIVE WOOCOMMERCE SYNC FIX\n');
console.log('═══════════════════════════════════════════════\n');
console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes)' : '✏️  LIVE MODE (will modify data)'}`);
console.log(`Strategy: ${CLEAN_MODE ? '🧹 CLEAN (delete + resync)' : '➕ ADDITIVE (keep existing, add missing)'}`);
console.log(`Starting from: Event ${START_FROM}\n`);

if (DRY_RUN) {
  console.log('⚠️  DRY RUN MODE: No changes will be made to the database\n');
}

if (CLEAN_MODE && !DRY_RUN) {
  console.log('⚠️  CLEAN MODE: Will delete existing tickets and resync from WooCommerce');
  console.log(`📦 Backups will be saved to: ${backupFile}\n`);
}

/**
 * CORRECT ticket ID extraction (matching TypeScript logic)
 */
function extractTicketAttendees(order, lineItem) {
  const attendees = [];
  const ticketDataMeta = lineItem.meta_data?.find((m) => m.key === '_ticket_data');

  if (!ticketDataMeta || !Array.isArray(ticketDataMeta.value)) {
    console.warn(`    ⚠️  Order ${order.id}: No _ticket_data found`);
    return attendees;
  }

  const ticketDataArray = ticketDataMeta.value;
  console.log(`    Processing ${ticketDataArray.length} tickets from order ${order.id}`);

  for (const ticketData of ticketDataArray) {
    const { uid, fields } = ticketData;
    if (!uid || !fields) {
      console.warn(`    ⚠️  Order ${order.id}: Ticket missing uid or fields`);
      continue;
    }

    // Extract name and email from fields
    let email = null;
    let firstName = null;
    let lastName = null;

    for (const [key, value] of Object.entries(fields)) {
      const fieldValue = value?.toString().trim();
      if (!fieldValue) continue;

      if (fieldValue.includes('@')) {
        email = fieldValue.toLowerCase();
      } else if (!firstName) {
        firstName = fieldValue;
      } else if (!lastName) {
        lastName = fieldValue;
      }
    }

    if (!email) {
      console.warn(`    ⚠️  Order ${order.id}, ticket ${uid}: No email found, skipping`);
      continue;
    }

    // CRITICAL FIX: Look for actual WooCommerce ticket ID in meta
    // This matches the TypeScript logic in src/lib/sync-attendees.ts
    const ticketIdKey = `_ticket_id_for_${uid}`;
    const ticketIdMeta = lineItem.meta_data?.find((m) => m.key === ticketIdKey);
    const ticketId = ticketIdMeta?.value || uid; // Fallback to uid if not found

    attendees.push({
      ticketId,
      email,
      firstName: firstName || order.billing.first_name || '',
      lastName: lastName || order.billing.last_name || '',
      bookerFirstName: order.billing.first_name || '',
      bookerLastName: order.billing.last_name || '',
      bookerEmail: order.billing.email?.toLowerCase() || '',
    });
  }

  return attendees;
}

/**
 * Fetch orders with retry logic
 */
async function retryWithBackoff(fn, maxRetries = 3, initialDelay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      const isRetryable =
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.message?.includes('socket hang up');

      if (!isRetryable || isLastAttempt) {
        throw error;
      }

      const delay = initialDelay * Math.pow(2, attempt - 1);
      console.log(`    ⚠️  Network error (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Fetch ALL orders for a product (no date filtering)
 */
async function getOrdersForProduct(productId) {
  let allOrders = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await woocommerce.get('orders', {
      per_page: 100,
      page,
      status: 'completed,processing,on-hold,pending', // Match TypeScript
    });

    const orders = response.data;

    // Filter for this product
    const filteredOrders = orders.filter(order =>
      order.line_items?.some(item => item.product_id?.toString() === productId)
    );

    allOrders.push(...filteredOrders);

    if (orders.length < 100) {
      hasMore = false;
    } else {
      page++;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return allOrders;
}

/**
 * Sync one event with full validation
 */
async function syncEventWithValidation(pool, event, eventIndex, totalEvents) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📅 [${eventIndex}/${totalEvents}] ${event.name}`);
  console.log(`    Event ID: ${event.id}`);
  console.log(`    Product: ${event.woocommerce_product_id}`);
  console.log(`    Date: ${event.event_date}`);

  // Step 1: Count existing tickets
  const beforeCount = await pool.query(
    `SELECT COUNT(*) as count FROM tablecn_attendees WHERE event_id = $1`,
    [event.id]
  );
  const beforeTickets = parseInt(beforeCount.rows[0].count);
  console.log(`    Before: ${beforeTickets} tickets in database`);

  // Step 2: Fetch from WooCommerce
  console.log(`    Fetching from WooCommerce...`);
  let orders;
  try {
    orders = await retryWithBackoff(
      () => getOrdersForProduct(event.woocommerce_product_id),
      3,
      2000
    );
  } catch (error) {
    console.error(`    ❌ Failed to fetch orders: ${error.message}`);
    return {
      success: false,
      reason: 'fetch_failed',
      error: error.message
    };
  }

  console.log(`    Found ${orders.length} orders in WooCommerce`);

  if (orders.length === 0) {
    console.log(`    ⚠️  No orders found - event may be genuinely empty`);
    return {
      success: true,
      reason: 'no_orders',
      woocommerceTickets: 0,
      dbTickets: beforeTickets,
      created: 0,
      deleted: 0
    };
  }

  // Step 3: Extract all tickets from orders
  const allTicketsFromWooCommerce = [];
  for (const order of orders) {
    const lineItems = order.line_items?.filter((item) =>
      item.product_id?.toString() === event.woocommerce_product_id
    ) || [];

    for (const lineItem of lineItems) {
      const tickets = extractTicketAttendees(order, lineItem);
      allTicketsFromWooCommerce.push(...tickets.map(t => ({
        ...t,
        orderId: order.id,
        orderDate: order.date_created,
      })));
    }
  }

  console.log(`    Extracted ${allTicketsFromWooCommerce.length} tickets from orders`);

  if (allTicketsFromWooCommerce.length === 0) {
    console.log(`    ⚠️  No valid tickets extracted (all missing emails?)`);
    return {
      success: true,
      reason: 'no_valid_tickets',
      woocommerceTickets: 0,
      dbTickets: beforeTickets,
      created: 0,
      deleted: 0
    };
  }

  // Step 4: Transaction - delete old (if CLEAN mode) and insert new
  if (DRY_RUN) {
    console.log(`    🔍 DRY RUN: Would process ${allTicketsFromWooCommerce.length} tickets`);
    if (CLEAN_MODE && beforeTickets > 0) {
      console.log(`    🔍 DRY RUN: Would delete ${beforeTickets} existing tickets`);
    }
    return {
      success: true,
      reason: 'dry_run',
      woocommerceTickets: allTicketsFromWooCommerce.length,
      dbTickets: beforeTickets,
      created: allTicketsFromWooCommerce.length,
      deleted: CLEAN_MODE ? beforeTickets : 0
    };
  }

  const client = await pool.connect();
  let deletedCount = 0;
  let createdCount = 0;

  try {
    await client.query('BEGIN');

    // CLEAN MODE: Delete all existing tickets for this event
    if (CLEAN_MODE && beforeTickets > 0) {
      console.log(`    🧹 CLEAN MODE: Backing up and deleting ${beforeTickets} existing tickets...`);

      // Backup before delete
      const existingTickets = await client.query(
        `SELECT * FROM tablecn_attendees WHERE event_id = $1`,
        [event.id]
      );

      deletedRecords.push({
        event_id: event.id,
        event_name: event.name,
        timestamp: new Date().toISOString(),
        tickets: existingTickets.rows
      });

      // Delete
      const deleteResult = await client.query(
        `DELETE FROM tablecn_attendees WHERE event_id = $1`,
        [event.id]
      );
      deletedCount = deleteResult.rowCount || 0;
      console.log(`    ✓ Deleted ${deletedCount} tickets`);
    }

    // ADDITIVE MODE or POST-CLEAN: Check for existing tickets
    let existingTicketIds = new Set();
    if (!CLEAN_MODE) {
      const existing = await client.query(
        `SELECT ticket_id FROM tablecn_attendees WHERE event_id = $1`,
        [event.id]
      );
      existingTicketIds = new Set(existing.rows.map(r => r.ticket_id));
      console.log(`    Found ${existingTicketIds.size} existing ticket IDs`);
    }

    // Insert tickets (skip existing in ADDITIVE mode)
    const shouldCheckIn = new Date(event.event_date) < new Date();

    for (const ticket of allTicketsFromWooCommerce) {
      // Skip if already exists (ADDITIVE mode only)
      if (!CLEAN_MODE && existingTicketIds.has(ticket.ticketId)) {
        continue;
      }

      await client.query(
        `INSERT INTO tablecn_attendees (
          id, event_id, email, first_name, last_name,
          ticket_id, woocommerce_order_id, woocommerce_order_date,
          booker_first_name, booker_last_name, booker_email,
          checked_in, checked_in_at, manually_added, locally_modified
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          generateId(),
          event.id,
          ticket.email,
          ticket.firstName,
          ticket.lastName,
          ticket.ticketId,
          ticket.orderId.toString(),
          new Date(ticket.orderDate),
          ticket.bookerFirstName,
          ticket.bookerLastName,
          ticket.bookerEmail,
          shouldCheckIn,
          shouldCheckIn ? new Date(event.event_date) : null,
          false,
          false,
        ]
      );
      createdCount++;
    }

    await client.query('COMMIT');
    console.log(`    ✓ Created ${createdCount} tickets`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`    ❌ Transaction failed: ${error.message}`);
    return {
      success: false,
      reason: 'transaction_failed',
      error: error.message
    };
  } finally {
    client.release();
  }

  // Step 5: Verify final count
  const afterCount = await pool.query(
    `SELECT COUNT(*) as count FROM tablecn_attendees WHERE event_id = $1`,
    [event.id]
  );
  const afterTickets = parseInt(afterCount.rows[0].count);
  console.log(`    After: ${afterTickets} tickets in database`);

  // Validation
  const expectedCount = CLEAN_MODE ? allTicketsFromWooCommerce.length : (beforeTickets - deletedCount + createdCount);

  if (afterTickets !== expectedCount && afterTickets !== allTicketsFromWooCommerce.length) {
    console.warn(`    ⚠️  Count mismatch: expected ${expectedCount}, got ${afterTickets}`);
  } else {
    console.log(`    ✅ Validation passed`);
  }

  return {
    success: true,
    woocommerceTickets: allTicketsFromWooCommerce.length,
    dbTickets: afterTickets,
    created: createdCount,
    deleted: deletedCount
  };
}

/**
 * Main sync process
 */
async function runSync() {
  // Set up graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n⏸️  Pause requested (Ctrl+C)...');
    console.log('   Finishing current event...');
    shouldPause = true;
  });

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  console.log('🔌 Connected to database\n');
  console.log('💡 Press Ctrl+C to pause gracefully\n');

  try {
    // Get all events
    const eventsResult = await pool.query(
      `SELECT id, name, event_date, woocommerce_product_id
       FROM tablecn_events
       WHERE woocommerce_product_id IS NOT NULL
       ORDER BY event_date ASC`
    );

    const events = eventsResult.rows;
    console.log(`Found ${events.length} total events\n`);

    const results = {
      success: 0,
      failed: 0,
      totalWooCommerceTickets: 0,
      totalCreated: 0,
      totalDeleted: 0,
      failedEvents: []
    };

    // Process events
    for (let i = START_FROM - 1; i < events.length; i++) {
      if (shouldPause) {
        console.log(`\n⏸️  PAUSED at event ${lastProcessedEvent}`);
        console.log(`\nTo resume: node sync-fix-complete.mjs --start=${lastProcessedEvent + 1}`);
        break;
      }

      const event = events[i];
      const eventIndex = i + 1;
      lastProcessedEvent = eventIndex;

      try {
        const result = await syncEventWithValidation(pool, event, eventIndex, events.length);

        if (result.success) {
          results.success++;
          results.totalWooCommerceTickets += (result.woocommerceTickets || 0);
          results.totalCreated += (result.created || 0);
          results.totalDeleted += (result.deleted || 0);
        } else {
          results.failed++;
          results.failedEvents.push({
            index: eventIndex,
            name: event.name,
            reason: result.reason,
            error: result.error
          });
        }

      } catch (error) {
        results.failed++;
        results.failedEvents.push({
          index: eventIndex,
          name: event.name,
          error: error.message
        });
        console.error(`\n❌ Event ${eventIndex} failed:`, error.message);
      }

      // Checkpoint every 10 events
      if (eventIndex % 10 === 0) {
        console.log(`\n━━━ Checkpoint: ${eventIndex}/${events.length} ━━━`);
        console.log(`   Success: ${results.success}, Failed: ${results.failed}`);
        console.log(`   Created: ${results.totalCreated}, Deleted: ${results.totalDeleted}`);
      }

      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Save backup if we deleted anything
    if (deletedRecords.length > 0 && !DRY_RUN) {
      fs.writeFileSync(backupFile, JSON.stringify(deletedRecords, null, 2));
      console.log(`\n📦 Backup saved: ${backupFile}`);
    }

    // Final report
    if (!shouldPause) {
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`\n✅ SYNC COMPLETE\n`);
      console.log(`   Events processed: ${results.success + results.failed}`);
      console.log(`   Successful: ${results.success}`);
      console.log(`   Failed: ${results.failed}`);
      console.log(`   WooCommerce tickets found: ${results.totalWooCommerceTickets}`);
      console.log(`   Tickets created: ${results.totalCreated}`);
      console.log(`   Tickets deleted: ${results.totalDeleted}`);

      if (results.failedEvents.length > 0) {
        console.log(`\n⚠️  Failed Events:`);
        results.failedEvents.forEach(e => {
          console.log(`   ${e.index}. ${e.name}`);
          console.log(`      Reason: ${e.reason || e.error}`);
        });
      }
    }

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
  } finally {
    await pool.end();
    console.log('\n🔌 Database closed');
  }
}

// Run it
runSync().catch(console.error);
