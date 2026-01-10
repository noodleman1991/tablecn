// Resume Resync Script - SEQUENTIAL with PAUSE capability
// Continues syncing from a specific event number
// Usage: node resume-resync-sequential.mjs [start_event_number]
//
// FEATURES:
// - Connection pooling (prevents timeouts)
// - Transaction batching (fewer queries per event)
// - SEQUENTIAL processing (one event at a time, no parallelization)
// - GRACEFUL PAUSE: Press Ctrl+C to save progress and exit cleanly
// - Better error recovery (failures don't stop sync)

import { createRequire } from 'module';
import pg from 'pg';
import { customAlphabet } from 'nanoid';

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

// Global pause flag for graceful shutdown
let shouldPause = false;
let lastProcessedEvent = 0;

/**
 * Retry function with exponential backoff
 * Handles transient network errors (socket hangs, DNS failures, timeouts)
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
        error.code === 'EADDRNOTAVAIL' ||
        error.message?.includes('socket hang up');

      if (!isRetryable || isLastAttempt) {
        throw error;
      }

      const delay = initialDelay * Math.pow(2, attempt - 1);
      console.log(`   ⚠️  Network error (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`);
      console.log(`      Error: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

function extractTicketAttendees(order, lineItem) {
  const attendees = [];
  const ticketDataMeta = lineItem.meta_data?.find((m) => m.key === '_ticket_data');

  if (!ticketDataMeta || !Array.isArray(ticketDataMeta.value)) {
    return attendees;
  }

  const ticketDataArray = ticketDataMeta.value;

  for (const ticketData of ticketDataArray) {
    const { uid, fields } = ticketData;
    if (!uid || !fields) continue;

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

    if (email) {
      attendees.push({
        ticketId: uid,
        email,
        firstName: firstName || order.billing.first_name || '',
        lastName: lastName || order.billing.last_name || '',
        bookerFirstName: order.billing.first_name || '',
        bookerLastName: order.billing.last_name || '',
        bookerEmail: order.billing.email?.toLowerCase() || '',
      });
    }
  }

  return attendees;
}

function getExtendedDateWindow(eventDate) {
  // For historical resync: NO DATE FILTERING
  // Fetch ALL orders for the product regardless of purchase date
  // This ensures early bird tickets (purchased 6+ months ahead) are included
  return null;  // null = no date filter
}

async function getOrdersForProduct(productId, dateWindow) {
  const allOrders = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const params = {
      per_page: 100,
      page,
      status: 'completed,processing,on-hold',
    };

    if (dateWindow) {
      params.after = dateWindow.after;
      params.before = dateWindow.before;
    }

    const response = await woocommerce.get('orders', params);
    const orders = response.data;

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
 * OPTIMIZED: Sync event attendees with transaction batching
 *
 * Before: N × 2 queries (SELECT + INSERT per ticket)
 * After: 1 + N queries (1 SELECT for all + N INSERTs in transaction)
 */
async function syncEventAttendees(pool, event, eventIndex, totalEvents) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📅 [${eventIndex}/${totalEvents}] ${event.name}`);
  console.log(`   Date: ${event.event_date}`);
  console.log(`   Product: ${event.woocommerce_product_id}`);

  const dateWindow = getExtendedDateWindow(event.event_date);
  const shouldCheckIn = new Date(event.event_date) < new Date();

  console.log(`   Auto check-in: ${shouldCheckIn ? 'YES (past event)' : 'NO (future event)'}`);

  // Fetch orders from WooCommerce
  let orders;
  try {
    orders = await retryWithBackoff(
      () => getOrdersForProduct(event.woocommerce_product_id, dateWindow),
      3,
      2000
    );
  } catch (error) {
    console.error(`   ✗ Error fetching orders after 3 retries:`, error.message);
    throw error;
  }

  // OPTIMIZATION: Collect all tickets for this event first
  const allTicketsForEvent = [];
  for (const order of orders) {
    const lineItems = order.line_items?.filter((item) =>
      item.product_id?.toString() === event.woocommerce_product_id
    ) || [];

    for (const lineItem of lineItems) {
      const tickets = extractTicketAttendees(order, lineItem);
      allTicketsForEvent.push(...tickets.map(t => ({
        ...t,
        orderId: order.id,
        orderDate: order.date_created,
      })));
    }
  }

  // OPTIMIZATION: Fetch existing tickets for this event (1 query instead of N)
  const existingTickets = await pool.query(
    `SELECT ticket_id FROM tablecn_attendees WHERE event_id = $1`,
    [event.id]
  );
  const existingTicketIds = new Set(existingTickets.rows.map(r => r.ticket_id));

  // OPTIMIZATION: Filter out duplicates in memory
  const newTickets = allTicketsForEvent.filter(t => !existingTicketIds.has(t.ticketId));

  if (newTickets.length === 0) {
    console.log(`   ✓ Processed ${allTicketsForEvent.length} tickets (0 created, all exist)`);
    return { total: allTicketsForEvent.length, created: 0 };
  }

  // OPTIMIZATION: Batch insert in transaction
  const client = await pool.connect();
  let createdCount = 0;

  try {
    await client.query('BEGIN');

    for (const ticket of newTickets) {
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
    console.log(`   ✓ Processed ${allTicketsForEvent.length} tickets (${createdCount} created)`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`   ✗ Transaction failed:`, error.message);
    throw error;
  } finally {
    client.release();
  }

  return { total: allTicketsForEvent.length, created: createdCount };
}

async function resumeResync() {
  const startFrom = parseInt(process.argv[2]) || 1;

  // Set up graceful shutdown handler
  process.on('SIGINT', () => {
    console.log('\n\n⏸️  Pause requested (Ctrl+C detected)...');
    console.log('   Finishing current event before stopping...');
    shouldPause = true;
  });

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  console.log('🔌 Connected to database pool\n');
  console.log('💡 Press Ctrl+C at any time to pause gracefully\n');

  try {
    console.log(`⏩ Starting from event ${startFrom}\n`);

    // Get ALL events
    const eventsResult = await pool.query(
      `SELECT id, name, event_date, woocommerce_product_id
       FROM tablecn_events
       WHERE woocommerce_product_id IS NOT NULL
       ORDER BY event_date ASC`
    );

    const events = eventsResult.rows;
    console.log(`Found ${events.length} total events`);
    console.log(`Processing ${events.length - startFrom + 1} events (starting from #${startFrom})\n`);

    let successCount = 0;
    let failureCount = 0;
    const failedEvents = [];
    let totalTicketsCreated = 0;
    let totalTicketsProcessed = 0;

    // SEQUENTIAL PROCESSING: One event at a time
    for (let i = startFrom - 1; i < events.length; i++) {
      // Check if pause was requested
      if (shouldPause) {
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`\n⏸️  PAUSED at event ${lastProcessedEvent}`);
        console.log(`\n📊 Progress Summary:`);
        console.log(`   Events processed: ${successCount + failureCount}/${i}`);
        console.log(`   Successful: ${successCount}`);
        console.log(`   Failed: ${failureCount}`);
        console.log(`   Tickets created: ${totalTicketsCreated}`);
        console.log(`   Tickets processed: ${totalTicketsProcessed}`);
        console.log(`\n💡 To resume from next event, run:`);
        console.log(`   node resume-resync-sequential.mjs ${lastProcessedEvent + 1}`);
        if (failedEvents.length > 0) {
          console.log(`\n⚠️  Failed events to retry:`);
          failedEvents.forEach(e => {
            console.log(`   - Event ${e.index}: node resume-resync-sequential.mjs ${e.index}`);
          });
        }
        break;
      }

      const event = events[i];
      const eventIndex = i + 1;
      lastProcessedEvent = eventIndex;

      try {
        const result = await syncEventAttendees(pool, event, eventIndex, events.length);
        successCount++;
        totalTicketsProcessed += result.total;
        totalTicketsCreated += result.created;

        // Progress checkpoint every 10 events
        if (eventIndex % 10 === 0) {
          console.log(`\n━━━ Checkpoint: ${eventIndex}/${events.length} events processed ━━━`);
          console.log(`   Successful: ${successCount}, Failed: ${failureCount}`);
          console.log(`   Tickets created: ${totalTicketsCreated}`);
          console.log(`   To resume from here: node resume-resync-sequential.mjs ${eventIndex + 1}\n`);
        }

      } catch (error) {
        failureCount++;
        failedEvents.push({
          index: eventIndex,
          name: event.name,
          id: event.id,
          productId: event.woocommerce_product_id,
          error: error.message,
        });
        console.error(`\n✗ Event ${eventIndex} failed:`, event.name);
        console.error(`   Error:`, error.message);
      }

      // Small delay between events to be gentle on WooCommerce API
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Only show completion if not paused
    if (!shouldPause) {
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`\n✅ Resync complete!`);
      console.log(`   Events processed: ${successCount + failureCount}/${events.length - startFrom + 1}`);
      console.log(`   Successful: ${successCount}`);
      console.log(`   Failed: ${failureCount}`);
      console.log(`   Tickets processed: ${totalTicketsProcessed}`);
      console.log(`   Tickets created: ${totalTicketsCreated}`);

      if (failedEvents.length > 0) {
        console.log(`\n⚠️  Failed Events (retry these manually):`);
        failedEvents.forEach(e => {
          console.log(`   - Event ${e.index}: ${e.name}`);
          console.log(`     ID: ${e.id}, Product: ${e.productId}`);
          console.log(`     Error: ${e.error}`);
        });
        console.log(`\n💡 To retry first failed event, run:`);
        console.log(`   node resume-resync-sequential.mjs ${failedEvents[0].index}`);
      }

      console.log(`\n📋 Next steps:`);
      console.log(`   1. Run: node rebuild-members.mjs`);
      console.log(`   2. Verify ticket counts in database`);
    }

  } catch (error) {
    console.error('Fatal error:', error);
    console.error('\n💡 To resume from where you left off, run:');
    console.error(`   node resume-resync-sequential.mjs ${lastProcessedEvent || startFrom}`);
  } finally {
    await pool.end();
    console.log('\n🔌 Database pool closed');
  }
}

resumeResync().catch(console.error);
