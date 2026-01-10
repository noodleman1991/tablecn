// Resume Resync Script
// Continues syncing from a specific event number
// Usage: node resume-resync.mjs [start_event_number]

import { createRequire } from 'module';
import pg from 'pg';
import { customAlphabet } from 'nanoid';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const { Client } = pg;

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
        throw error;  // Non-retryable or exhausted retries
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
        bookerEmail: order.billing.email || '',
      });
    }
  }

  return attendees;
}

function getExtendedDateWindow(eventDate) {
  // For historical resync: NO DATE FILTERING
  // Fetch ALL orders for the product regardless of purchase date
  // This ensures early bird tickets (purchased 6+ months ahead) are included
  //
  // Previously used 180-day window which excluded early bird purchases
  // Example: "Village of Lovers" (Nov 21, 2023) only fetched orders from May 25 onwards
  // Missing 14 of 23 tickets (61% data loss!)
  return null;  // null = no date filter
}

function shouldMarkAsCheckedIn(eventDate) {
  // Use today's date at 23:59:59 UTC (dynamic cutoff)
  const cutoff = new Date();
  cutoff.setUTCHours(23, 59, 59, 999);
  return new Date(eventDate) < cutoff;
}

async function getOrdersForProduct(productId, dateWindow) {
  const product = await woocommerce.get(`products/${productId}`);
  const isVariable = product.data.type === 'variable';

  let allOrders = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= 50) {
    const params = {
      per_page: 100,
      page,
      status: 'completed,processing,on-hold',
    };

    // Only add date filter if dateWindow is provided (not null)
    // For historical resync, dateWindow is null = fetch ALL orders
    if (dateWindow) {
      params.after = dateWindow.after;
      params.before = dateWindow.before;
    }

    const response = await woocommerce.get('orders', params);

    const orders = response.data;
    const matchingOrders = orders.filter((order) => {
      return order.line_items?.some((item) => {
        return item.product_id?.toString() === productId;
      });
    });

    allOrders = allOrders.concat(matchingOrders);
    hasMore = orders.length === 100;
    page++;
  }

  return allOrders;
}

async function syncEventAttendees(client, event, eventIndex, totalEvents) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📅 [${eventIndex}/${totalEvents}] ${event.name}`);
  console.log(`   Date: ${event.event_date}`);
  console.log(`   Product ID: ${event.woocommerce_product_id}`);

  const dateWindow = getExtendedDateWindow(event.event_date);
  const shouldCheckIn = shouldMarkAsCheckedIn(event.event_date);

  console.log(`   Auto check-in: ${shouldCheckIn ? 'YES (past event)' : 'NO (future event)'}`);

  let orders;
  try {
    orders = await retryWithBackoff(
      () => getOrdersForProduct(event.woocommerce_product_id, dateWindow),
      3,     // 3 retries
      2000   // Start with 2 second delay
    );
  } catch (error) {
    console.error(`   ✗ Error fetching orders after 3 retries:`, error.message);
    console.error(`   ⚠️  This event will need manual review`);
    return { total: 0, created: 0, error: error.message };
  }

  let totalTickets = 0;
  let createdCount = 0;

  for (const order of orders) {
    const lineItems = order.line_items?.filter((item) =>
      item.product_id?.toString() === event.woocommerce_product_id
    ) || [];

    for (const lineItem of lineItems) {
      const tickets = extractTicketAttendees(order, lineItem);

      for (const ticket of tickets) {
        totalTickets++;

        try {
          // Check if ticket already exists
          const existingTicket = await client.query(
            `SELECT id FROM tablecn_attendees
             WHERE ticket_id = $1 AND event_id = $2`,
            [ticket.ticketId, event.id]
          );

          if (existingTicket.rows.length > 0) {
            continue;
          }

          await client.query(
            `INSERT INTO tablecn_attendees (
              id, event_id, email, first_name, last_name,
              ticket_id, woocommerce_order_id, woocommerce_order_date,
              booker_first_name, booker_last_name, booker_email,
              checked_in, checked_in_at,
              manually_added, locally_modified
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
              generateId(),
              event.id,
              ticket.email,
              ticket.firstName,
              ticket.lastName,
              ticket.ticketId,
              order.id.toString(),
              new Date(order.date_created),  // WooCommerce order date
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
        } catch (error) {
          console.error(`   ✗ Error inserting ticket ${ticket.ticketId}:`, error.message);
        }
      }
    }
  }

  console.log(`   ✓ Processed ${totalTickets} tickets (${createdCount} created)`);
  return { total: totalTickets, created: createdCount };
}

async function resumeResync() {
  // Get start event number from command line argument
  const startFrom = parseInt(process.argv[2]) || 1;

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    // Neon pooler connection settings to prevent timeouts
    connectionTimeoutMillis: 10000,
    query_timeout: 30000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });

  await client.connect();
  console.log('🔌 Connected to database\n');

  try {
    console.log(`⏩ Resuming from event ${startFrom}\n`);

    // Get ALL events
    const eventsResult = await client.query(
      `SELECT id, name, event_date, woocommerce_product_id
       FROM tablecn_events
       WHERE woocommerce_product_id IS NOT NULL
       ORDER BY event_date ASC`
    );

    const events = eventsResult.rows;
    console.log(`Found ${events.length} total events`);
    console.log(`Starting from event ${startFrom} (${events.length - startFrom + 1} remaining)\n`);

    let totalEventsProcessed = 0;
    let totalTicketsCreated = 0;
    let totalTicketsProcessed = 0;
    let totalErrors = 0;

    // Start from specified event
    for (let i = startFrom - 1; i < events.length; i++) {
      const event = events[i];

      try {
        const result = await syncEventAttendees(client, event, i + 1, events.length);
        totalEventsProcessed++;
        totalTicketsProcessed += result.total;
        totalTicketsCreated += result.created;

        if (result.error) {
          totalErrors++;
        }

        // Save progress every 10 events
        if ((i + 1) % 10 === 0) {
          console.log(`\n💾 Progress checkpoint: Event ${i + 1}/${events.length}`);
          console.log(`   To resume from here if interrupted: node resume-resync.mjs ${i + 2}\n`);
        }
      } catch (error) {
        console.error(`   ✗ Error syncing event:`, error.message);
        totalErrors++;
      }

      // Rate limiting: 500ms delay between events
      if (i < events.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`\n✅ Resync complete!`);
    console.log(`   Events processed: ${totalEventsProcessed}/${events.length - startFrom + 1}`);
    console.log(`   Tickets processed: ${totalTicketsProcessed}`);
    console.log(`   Tickets created: ${totalTicketsCreated}`);
    console.log(`   Errors: ${totalErrors}`);
    console.log(`\n📋 Next steps:`);
    console.log(`   1. Run: node rebuild-members.mjs`);
    console.log(`   2. Run: node verify-resync.mjs`);

  } catch (error) {
    console.error('Fatal error:', error);
    console.error('\n💡 To resume from where you left off, run:');
    console.error(`   node resume-resync.mjs ${startFrom}`);
  } finally {
    await client.end();
  }
}

// Run the resync
resumeResync();
