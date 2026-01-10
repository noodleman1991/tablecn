#!/usr/bin/env node
/**
 * MASTER SYNC SCRIPT - Single source of truth for all WooCommerce syncing
 *
 * This script replaces all other sync scripts with correct, consistent logic:
 * - Correct ticket ID extraction (_ticket_id_for_{uid} pattern)
 * - Event date sync from WooCommerce meta_data.event_date
 * - Sequential processing (WooCommerce doesn't support concurrency)
 * - Complete order data capture (orderId, orderDate, booker info)
 * - Consistent order status filtering: completed,processing,on-hold,pending
 * - Timezone-aware checked-in logic (23:00 London cutoff)
 * - Pool-based database connection
 * - Backup creation before CLEAN sync
 *
 * Usage:
 *   node master-sync.mjs                    # CLEAN sync all events (default)
 *   node master-sync.mjs --additive         # Keep existing, only add missing
 *   node master-sync.mjs --events 1,2,3     # Sync specific event IDs only
 *   node master-sync.mjs --fix-dates        # Also fix event dates from WooCommerce
 *   node master-sync.mjs --fix-members      # Re-sync member names from ticket data
 *   node master-sync.mjs --recalc-members   # Recalculate member stats
 *   node master-sync.mjs --backup-only      # Just create backup, no sync
 *   node master-sync.mjs --dry-run          # Show what would happen
 */

import { createRequire } from 'module';
import pg from 'pg';
import { customAlphabet } from 'nanoid';
import fs from 'fs';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const { Pool } = pg;

// ID generator (matches app logic)
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
  timeout: 30000,
});

// Parse command line arguments
const args = {
  dryRun: process.argv.includes('--dry-run'),
  additive: process.argv.includes('--additive'),
  fixDates: process.argv.includes('--fix-dates'),
  fixMembers: process.argv.includes('--fix-members'),
  recalcMembers: process.argv.includes('--recalc-members'),
  backupOnly: process.argv.includes('--backup-only'),
  events: (() => {
    // Support both --events=id1,id2 and --events id1,id2
    const eventsIdx = process.argv.findIndex(arg => arg === '--events' || arg.startsWith('--events='));
    if (eventsIdx === -1) return null;

    const eventsArg = process.argv[eventsIdx];
    if (eventsArg.includes('=')) {
      // Format: --events=id1,id2
      return eventsArg.split('=')[1].split(',').map(id => id.trim());
    } else if (process.argv[eventsIdx + 1]) {
      // Format: --events id1,id2
      return process.argv[eventsIdx + 1].split(',').map(id => id.trim());
    }
    return null;
  })(),
};

// Timestamp for file names
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

// Graceful shutdown
let shouldStop = false;
process.on('SIGINT', () => {
  console.log('\n\n⏸️  Stopping gracefully... (Ctrl+C again to force quit)');
  shouldStop = true;
});

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

/**
 * Retry with exponential backoff
 */
async function retryWithBackoff(fn, maxRetries = 3, initialDelay = 2000) {
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
 * Parse YYYYMMDD date format from WooCommerce
 */
function parseYYYYMMDD(dateStr) {
  if (!dateStr || typeof dateStr !== 'string' || dateStr.length !== 8) {
    return null;
  }
  const year = parseInt(dateStr.substring(0, 4));
  const month = parseInt(dateStr.substring(4, 6)) - 1; // JS months are 0-indexed
  const day = parseInt(dateStr.substring(6, 8));
  return new Date(year, month, day);
}

/**
 * Extract event date from product name as fallback
 * Matches logic in src/lib/woocommerce.ts:extractEventDate()
 */
function extractDateFromProductName(productName) {
  if (!productName || typeof productName !== 'string') {
    return null;
  }

  // Pattern 1: "Event Name - DD/MM/YYYY" (e.g., "Dinner - 25/01/2026")
  const datePattern1 = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
  const match1 = productName.match(datePattern1);
  if (match1) {
    const [, day, month, year] = match1;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // Pattern 2: "Event Name - YYYY-MM-DD" (e.g., "Dinner - 2026-01-25")
  const datePattern2 = /(\d{4})-(\d{1,2})-(\d{1,2})/;
  const match2 = productName.match(datePattern2);
  if (match2) {
    const [, year, month, day] = match2;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

/**
 * Get London timezone offset for checked-in logic
 */
function isEventPast(eventDate) {
  const now = new Date();
  const cutoff = new Date(eventDate);
  cutoff.setHours(23, 0, 0, 0);
  return now > cutoff;
}

/**
 * CORRECT ticket extraction logic (matches TypeScript in sync-attendees.ts)
 */
function extractTicketsFromOrder(order, lineItem, productId) {
  const tickets = [];
  const ticketDataMeta = lineItem.meta_data?.find(m => m.key === '_ticket_data');

  if (!ticketDataMeta || !Array.isArray(ticketDataMeta.value)) {
    // Fallback: create tickets from billing info based on quantity
    const quantity = parseInt(lineItem.quantity) || 1;
    console.log(`    ⚠️  Order ${order.id}: No _ticket_data, falling back to billing (${quantity} ticket(s))`);

    for (let i = 0; i < quantity; i++) {
      tickets.push({
        ticketId: `${lineItem.id}-fallback-${i}`,
        email: order.billing?.email?.toLowerCase() || '',
        firstName: order.billing?.first_name || '',
        lastName: order.billing?.last_name || '',
        bookerFirstName: order.billing?.first_name || '',
        bookerLastName: order.billing?.last_name || '',
        bookerEmail: order.billing?.email?.toLowerCase() || '',
        orderId: order.id,
        orderDate: order.date_created,
        isFallback: true,
      });
    }
    return tickets;
  }

  const ticketDataArray = ticketDataMeta.value;

  for (let index = 0; index < ticketDataArray.length; index++) {
    const ticketData = ticketDataArray[index];
    const { uid, fields } = ticketData;

    if (!uid || !fields) {
      console.log(`    ⚠️  Order ${order.id}: Ticket missing uid or fields, skipping`);
      continue;
    }

    // Extract email and names from fields
    let email = null;
    let firstName = null;
    let lastName = null;

    for (const [key, value] of Object.entries(fields)) {
      const fieldValue = value?.toString().trim();
      if (!fieldValue) continue;

      // Skip corrupted values like "first name" or "family name" literals
      if (fieldValue.toLowerCase() === 'first name' ||
          fieldValue.toLowerCase() === 'family name' ||
          fieldValue.toLowerCase() === 'last name') {
        console.log(`    ⚠️  Order ${order.id}: Skipping corrupted field value "${fieldValue}"`);
        continue;
      }

      if (fieldValue.includes('@')) {
        email = fieldValue.toLowerCase(); // NORMALIZE EMAIL
      } else if (!firstName) {
        firstName = fieldValue;
      } else if (!lastName) {
        lastName = fieldValue;
      }
    }

    if (!email) {
      console.log(`    ⚠️  Order ${order.id}, ticket ${uid}: No email found, using billing email`);
      email = order.billing?.email?.toLowerCase() || '';
    }

    if (!email) {
      console.log(`    ⚠️  Order ${order.id}, ticket ${uid}: No email at all, skipping`);
      continue;
    }

    // CRITICAL FIX: Look for actual WooCommerce ticket ID
    // Format: _ticket_id_for_{uid} contains the real ticket number
    const ticketIdKey = `_ticket_id_for_${uid}`;
    const ticketIdMeta = lineItem.meta_data?.find(m => m.key === ticketIdKey);
    const ticketId = ticketIdMeta?.value || `${lineItem.id}-${index}`; // Fallback to generated ID

    tickets.push({
      ticketId,
      email,
      firstName: firstName || order.billing?.first_name || '',
      lastName: lastName || order.billing?.last_name || '',
      bookerFirstName: order.billing?.first_name || '',
      bookerLastName: order.billing?.last_name || '',
      bookerEmail: order.billing?.email?.toLowerCase() || '',
      orderId: order.id,
      orderDate: order.date_created,
      isFallback: false,
    });
  }

  return tickets;
}

/**
 * Fetch ALL orders for a product (no date filtering to get complete data)
 */
async function getOrdersForProduct(productId) {
  let allOrders = [];
  let page = 1;
  let hasMore = true;
  const maxPages = 50;

  while (hasMore && page <= maxPages) {
    const response = await woocommerce.get('orders', {
      per_page: 100,
      page,
      status: 'completed,processing,on-hold,pending', // ALL valid statuses
    });

    const orders = response.data;

    // Filter for this product
    const filteredOrders = orders.filter(order =>
      order.line_items?.some(item =>
        item.product_id?.toString() === productId.toString()
      )
    );

    allOrders.push(...filteredOrders);

    if (orders.length < 100) {
      hasMore = false;
    } else {
      page++;
    }

    // Rate limit - WooCommerce doesn't like too many requests
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return allOrders;
}

/**
 * Create full database backup
 */
async function createBackup() {
  console.log('\n📦 Creating database backup...\n');

  const backup = {
    timestamp: new Date().toISOString(),
    events: [],
    attendees: [],
    members: [],
  };

  // Backup events
  const eventsResult = await pool.query('SELECT * FROM tablecn_events');
  backup.events = eventsResult.rows;
  console.log(`   Events: ${backup.events.length}`);

  // Backup attendees
  const attendeesResult = await pool.query('SELECT * FROM tablecn_attendees');
  backup.attendees = attendeesResult.rows;
  console.log(`   Attendees: ${backup.attendees.length}`);

  // Backup members
  const membersResult = await pool.query('SELECT * FROM tablecn_members');
  backup.members = membersResult.rows;
  console.log(`   Members: ${backup.members.length}`);

  const filename = `backup-${timestamp}.json`;
  fs.writeFileSync(filename, JSON.stringify(backup, null, 2));
  console.log(`\n✅ Backup saved to: ${filename}`);

  return filename;
}

/**
 * Fix event dates from WooCommerce meta_data.event_date
 * Falls back to extracting date from product name if no meta_data
 */
async function fixEventDates() {
  console.log('\n📅 Fixing event dates from WooCommerce...\n');

  const eventsResult = await pool.query(`
    SELECT id, name, event_date, woocommerce_product_id
    FROM tablecn_events
    WHERE woocommerce_product_id IS NOT NULL
    ORDER BY event_date DESC
  `);

  const events = eventsResult.rows;
  console.log(`Checking ${events.length} events...\n`);

  const results = { fixed: 0, correct: 0, noWcDate: 0, errors: 0, fixedFromName: 0 };

  for (let i = 0; i < events.length; i++) {
    if (shouldStop) break;

    const event = events[i];

    try {
      // Fetch product from WooCommerce
      const response = await retryWithBackoff(
        () => woocommerce.get(`products/${event.woocommerce_product_id}`)
      );
      const product = response.data;

      // Try to get date from meta_data first
      const eventDateMeta = product.meta_data?.find(m => m.key === 'event_date');
      let wcDate = null;
      let dateSource = null;

      if (eventDateMeta && eventDateMeta.value) {
        wcDate = parseYYYYMMDD(eventDateMeta.value.toString());
        dateSource = 'meta';
      }

      // Fallback: Extract date from product name
      if (!wcDate && product.name) {
        wcDate = extractDateFromProductName(product.name);
        dateSource = 'name';
      }

      if (!wcDate) {
        results.noWcDate++;
        continue;
      }

      // Parse DB date
      const dbDate = new Date(event.event_date);
      dbDate.setHours(0, 0, 0, 0);
      wcDate.setHours(0, 0, 0, 0);

      // Compare dates
      const daysDiff = Math.round((wcDate - dbDate) / (1000 * 60 * 60 * 24));

      if (daysDiff === 0) {
        results.correct++;
      } else {
        if (!args.dryRun) {
          await pool.query(
            'UPDATE tablecn_events SET event_date = $1, updated_at = NOW() WHERE id = $2',
            [wcDate, event.id]
          );
        }
        results.fixed++;
        if (dateSource === 'name') {
          results.fixedFromName++;
        }
        console.log(`   ✓ ${event.name.substring(0, 50)}`);
        console.log(`     ${dbDate.toISOString().split('T')[0]} → ${wcDate.toISOString().split('T')[0]} (from ${dateSource})`);
      }

    } catch (error) {
      results.errors++;
      console.error(`   ✗ Error: ${event.name.substring(0, 40)} - ${error.message}`);
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  console.log('\n📊 Event Date Fix Summary:');
  console.log(`   Correct: ${results.correct}`);
  console.log(`   Fixed: ${results.fixed}${args.dryRun ? ' (dry run)' : ''}`);
  if (results.fixedFromName > 0) {
    console.log(`     (${results.fixedFromName} from product name fallback)`);
  }
  console.log(`   No WC date: ${results.noWcDate}`);
  console.log(`   Errors: ${results.errors}`);

  return results;
}

/**
 * Sync attendees for a single event
 */
async function syncEventAttendees(event, isCleanMode) {
  const productId = event.woocommerce_product_id;

  // Step 1: Count existing tickets
  const beforeCount = await pool.query(
    'SELECT COUNT(*) as count FROM tablecn_attendees WHERE event_id = $1',
    [event.id]
  );
  const beforeTickets = parseInt(beforeCount.rows[0].count);

  // Step 2: Fetch from WooCommerce
  let orders;
  try {
    orders = await retryWithBackoff(() => getOrdersForProduct(productId));
  } catch (error) {
    return {
      success: false,
      reason: 'fetch_failed',
      error: error.message,
      beforeTickets,
    };
  }

  if (orders.length === 0) {
    return {
      success: true,
      reason: 'no_orders',
      wcTickets: 0,
      beforeTickets,
      afterTickets: beforeTickets,
      created: 0,
      deleted: 0,
    };
  }

  // Step 3: Extract all tickets from orders
  const allTickets = [];
  for (const order of orders) {
    const lineItems = order.line_items?.filter(item =>
      item.product_id?.toString() === productId.toString()
    ) || [];

    for (const lineItem of lineItems) {
      const tickets = extractTicketsFromOrder(order, lineItem, productId);
      allTickets.push(...tickets);
    }
  }

  if (allTickets.length === 0) {
    return {
      success: true,
      reason: 'no_valid_tickets',
      wcTickets: 0,
      beforeTickets,
      afterTickets: beforeTickets,
      created: 0,
      deleted: 0,
    };
  }

  // Step 4: Database operations
  if (args.dryRun) {
    return {
      success: true,
      reason: 'dry_run',
      wcTickets: allTickets.length,
      beforeTickets,
      created: allTickets.length,
      deleted: isCleanMode ? beforeTickets : 0,
    };
  }

  const client = await pool.connect();
  let deletedCount = 0;
  let createdCount = 0;

  try {
    await client.query('BEGIN');

    // CLEAN MODE: Delete all existing tickets
    if (isCleanMode && beforeTickets > 0) {
      const deleteResult = await client.query(
        'DELETE FROM tablecn_attendees WHERE event_id = $1',
        [event.id]
      );
      deletedCount = deleteResult.rowCount || 0;
    }

    // Get existing ticket IDs (for ADDITIVE mode)
    let existingTicketIds = new Set();
    if (!isCleanMode) {
      const existing = await client.query(
        'SELECT ticket_id FROM tablecn_attendees WHERE event_id = $1',
        [event.id]
      );
      existingTicketIds = new Set(existing.rows.map(r => r.ticket_id));
    }

    // Insert tickets
    const shouldCheckIn = isEventPast(event.event_date);

    for (const ticket of allTickets) {
      // Skip if already exists (ADDITIVE mode only)
      if (!isCleanMode && existingTicketIds.has(ticket.ticketId)) {
        continue;
      }

      await client.query(
        `INSERT INTO tablecn_attendees (
          id, event_id, email, first_name, last_name,
          ticket_id, woocommerce_order_id, woocommerce_order_date,
          booker_first_name, booker_last_name, booker_email,
          checked_in, checked_in_at, manually_added, locally_modified
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (ticket_id, event_id) DO NOTHING`,
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

  } catch (error) {
    await client.query('ROLLBACK');
    return {
      success: false,
      reason: 'transaction_failed',
      error: error.message,
      beforeTickets,
    };
  } finally {
    client.release();
  }

  // Verify final count
  const afterCount = await pool.query(
    'SELECT COUNT(*) as count FROM tablecn_attendees WHERE event_id = $1',
    [event.id]
  );
  const afterTickets = parseInt(afterCount.rows[0].count);

  return {
    success: true,
    wcTickets: allTickets.length,
    beforeTickets,
    afterTickets,
    created: createdCount,
    deleted: deletedCount,
  };
}

/**
 * Sync all events
 */
async function syncAllEvents() {
  const isCleanMode = !args.additive;

  console.log(`\n🔄 Syncing attendees (${isCleanMode ? 'CLEAN' : 'ADDITIVE'} mode)...\n`);

  // Get events to sync
  let eventsQuery = `
    SELECT id, name, event_date, woocommerce_product_id
    FROM tablecn_events
    WHERE woocommerce_product_id IS NOT NULL
  `;

  if (args.events) {
    eventsQuery += ` AND id = ANY($1)`;
  }

  eventsQuery += ` ORDER BY event_date ASC`;

  const eventsResult = args.events
    ? await pool.query(eventsQuery, [args.events])
    : await pool.query(eventsQuery);

  const events = eventsResult.rows;
  console.log(`Found ${events.length} events to sync\n`);

  const results = {
    success: 0,
    failed: 0,
    totalWcTickets: 0,
    totalCreated: 0,
    totalDeleted: 0,
    failedEvents: [],
  };

  for (let i = 0; i < events.length; i++) {
    if (shouldStop) {
      console.log(`\n⏸️  Stopped at event ${i + 1}/${events.length}`);
      break;
    }

    const event = events[i];
    console.log(`[${i + 1}/${events.length}] ${event.name.substring(0, 50)}`);

    try {
      const result = await syncEventAttendees(event, isCleanMode);

      if (result.success) {
        results.success++;
        results.totalWcTickets += (result.wcTickets || 0);
        results.totalCreated += (result.created || 0);
        results.totalDeleted += (result.deleted || 0);

        console.log(`   ✓ WC: ${result.wcTickets || 0} | Before: ${result.beforeTickets} | After: ${result.afterTickets || result.beforeTickets}`);
      } else {
        results.failed++;
        results.failedEvents.push({
          name: event.name,
          reason: result.reason,
          error: result.error,
        });
        console.log(`   ✗ Failed: ${result.reason}`);
      }

    } catch (error) {
      results.failed++;
      results.failedEvents.push({
        name: event.name,
        error: error.message,
      });
      console.log(`   ✗ Error: ${error.message}`);
    }

    // Rate limit between events
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log('\n📊 Sync Summary:');
  console.log(`   Events processed: ${results.success + results.failed}`);
  console.log(`   Successful: ${results.success}`);
  console.log(`   Failed: ${results.failed}`);
  console.log(`   WC tickets found: ${results.totalWcTickets}`);
  console.log(`   Tickets created: ${results.totalCreated}${args.dryRun ? ' (dry run)' : ''}`);
  console.log(`   Tickets deleted: ${results.totalDeleted}${args.dryRun ? ' (dry run)' : ''}`);

  if (results.failedEvents.length > 0) {
    console.log('\n⚠️  Failed Events:');
    results.failedEvents.forEach((e, i) => {
      console.log(`   ${i + 1}. ${e.name.substring(0, 50)}`);
      console.log(`      ${e.reason || e.error}`);
    });
  }

  return results;
}

/**
 * Fix member names from attendee data
 */
async function fixMemberNames() {
  console.log('\n👤 Fixing member names from ticket data...\n');

  // Find members with corrupted names
  const corruptedMembers = await pool.query(`
    SELECT id, email, first_name, last_name
    FROM tablecn_members
    WHERE LOWER(first_name) = 'first name'
       OR LOWER(last_name) = 'family name'
       OR LOWER(last_name) = 'last name'
       OR first_name IS NULL
       OR first_name = ''
  `);

  console.log(`Found ${corruptedMembers.rows.length} members with corrupted/missing names\n`);

  let fixed = 0;
  let notFound = 0;

  for (const member of corruptedMembers.rows) {
    // Find most recent attendee record for this email with valid names
    const attendeeResult = await pool.query(`
      SELECT first_name, last_name
      FROM tablecn_attendees
      WHERE LOWER(email) = LOWER($1)
        AND first_name IS NOT NULL
        AND first_name != ''
        AND LOWER(first_name) != 'first name'
      ORDER BY created_at DESC
      LIMIT 1
    `, [member.email]);

    if (attendeeResult.rows.length > 0) {
      const { first_name, last_name } = attendeeResult.rows[0];

      if (!args.dryRun) {
        await pool.query(
          'UPDATE tablecn_members SET first_name = $1, last_name = $2, updated_at = NOW() WHERE id = $3',
          [first_name, last_name || '', member.id]
        );
      }

      fixed++;
      console.log(`   ✓ ${member.email}: "${member.first_name} ${member.last_name}" → "${first_name} ${last_name || ''}"`);
    } else {
      notFound++;
    }
  }

  console.log('\n📊 Member Name Fix Summary:');
  console.log(`   Fixed: ${fixed}${args.dryRun ? ' (dry run)' : ''}`);
  console.log(`   No valid data found: ${notFound}`);

  return { fixed, notFound };
}

/**
 * Recalculate member statistics
 */
async function recalculateMemberStats() {
  console.log('\n📊 Recalculating member statistics...\n');

  // Get all members
  const membersResult = await pool.query('SELECT id, email FROM tablecn_members');
  const members = membersResult.rows;
  console.log(`Processing ${members.length} members...\n`);

  let updated = 0;

  for (let i = 0; i < members.length; i++) {
    if (shouldStop) break;

    const member = members[i];

    // Calculate total events attended (distinct events where checked in)
    const statsResult = await pool.query(`
      SELECT
        COUNT(DISTINCT a.event_id) as total_events,
        MAX(e.event_date) as last_event_date,
        COUNT(DISTINCT CASE
          WHEN e.event_date >= NOW() - INTERVAL '365 days' THEN a.event_id
        END) as events_last_year
      FROM tablecn_attendees a
      JOIN tablecn_events e ON a.event_id = e.id
      WHERE LOWER(a.email) = LOWER($1)
        AND a.checked_in = true
    `, [member.email]);

    const stats = statsResult.rows[0];
    const totalEvents = parseInt(stats.total_events) || 0;
    const eventsLastYear = parseInt(stats.events_last_year) || 0;
    const isActiveMember = eventsLastYear >= 3;
    const lastEventDate = stats.last_event_date;
    const membershipExpiresAt = lastEventDate
      ? new Date(new Date(lastEventDate).getTime() + 365 * 24 * 60 * 60 * 1000)
      : null;

    if (!args.dryRun) {
      await pool.query(`
        UPDATE tablecn_members
        SET
          total_events_attended = $1,
          is_active_member = $2,
          last_event_date = $3,
          membership_expires_at = $4,
          updated_at = NOW()
        WHERE id = $5
      `, [totalEvents, isActiveMember, lastEventDate, membershipExpiresAt, member.id]);
    }

    updated++;

    // Progress update every 100 members
    if (updated % 100 === 0) {
      console.log(`   Progress: ${updated}/${members.length}`);
    }
  }

  console.log(`\n✅ Updated ${updated} member statistics${args.dryRun ? ' (dry run)' : ''}`);

  return { updated };
}

/**
 * Main entry point
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    MASTER SYNC SCRIPT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Configuration:');
  console.log(`   Dry Run: ${args.dryRun ? 'YES (no changes will be made)' : 'NO'}`);
  console.log(`   Mode: ${args.additive ? 'ADDITIVE (keep existing)' : 'CLEAN (delete + resync)'}`);
  console.log(`   Fix Dates: ${args.fixDates ? 'YES' : 'NO'}`);
  console.log(`   Fix Members: ${args.fixMembers ? 'YES' : 'NO'}`);
  console.log(`   Recalc Members: ${args.recalcMembers ? 'YES' : 'NO'}`);
  console.log(`   Backup Only: ${args.backupOnly ? 'YES' : 'NO'}`);
  console.log(`   Specific Events: ${args.events ? args.events.join(', ') : 'ALL'}\n`);

  try {
    // Always create backup first (unless dry run)
    if (!args.dryRun) {
      await createBackup();
    }

    if (args.backupOnly) {
      console.log('\n✅ Backup complete. Exiting.\n');
      return;
    }

    // Fix event dates if requested
    if (args.fixDates) {
      await fixEventDates();
    }

    // Always sync attendees (this is the core function)
    await syncAllEvents();

    // Fix member names if requested
    if (args.fixMembers) {
      await fixMemberNames();
    }

    // Recalculate member stats if requested
    if (args.recalcMembers) {
      await recalculateMemberStats();
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('                    SYNC COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run
main().catch(console.error);
