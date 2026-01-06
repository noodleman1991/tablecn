// Comprehensive Historical Resync Script
// Resyncs ALL events from March 2023 - January 2026
// Deletes all existing attendee data and rebuilds from WooCommerce
// Marks all past events (before Jan 5, 2026) as checked in

import { createRequire } from 'module';
import pg from 'pg';
import { customAlphabet } from 'nanoid';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const { Client } = pg;

// ID generator (matching src/lib/id.ts)
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
 * Extract individual tickets from WooCommerce order
 */
function extractTicketAttendees(order, lineItem) {
  const attendees = [];

  // Find _ticket_data in meta_data
  const ticketDataMeta = lineItem.meta_data?.find((m) => m.key === '_ticket_data');

  if (!ticketDataMeta || !Array.isArray(ticketDataMeta.value)) {
    console.log(`   ⚠️  No _ticket_data for order ${order.id}`);
    return attendees;
  }

  const ticketDataArray = ticketDataMeta.value;

  for (const ticketData of ticketDataArray) {
    const { uid, index, fields } = ticketData;

    if (!uid || !fields) {
      console.warn(`   ⚠️  Missing uid or fields in ticket data for order ${order.id}`);
      continue;
    }

    // Extract field values (field keys are hashed)
    let email = null;
    let firstName = null;
    let lastName = null;

    for (const [key, value] of Object.entries(fields)) {
      const fieldValue = value?.toString().trim();
      if (!fieldValue) continue;

      // Email field contains @ symbol
      if (fieldValue.includes('@')) {
        email = fieldValue.toLowerCase();
      }
      // First name field (usually first non-email field)
      else if (!firstName) {
        firstName = fieldValue;
      }
      // Last name field (second non-email field)
      else if (!lastName) {
        lastName = fieldValue;
      }
    }

    if (email) {
      attendees.push({
        ticketId: uid, // WooCommerce ticket UID
        email,
        firstName: firstName || order.billing.first_name || '',
        lastName: lastName || order.billing.last_name || '',
        // Booker information (person who placed the order)
        bookerFirstName: order.billing.first_name || '',
        bookerLastName: order.billing.last_name || '',
        bookerEmail: order.billing.email || '',
      });
    }
  }

  return attendees;
}

/**
 * Get extended date window for fetching orders (6 months before to 7 days after)
 */
function getExtendedDateWindow(eventDate) {
  const after = new Date(eventDate);
  after.setMonth(after.getMonth() - 6);

  const before = new Date(eventDate);
  before.setDate(before.getDate() + 7);

  return {
    after: after.toISOString(),
    before: before.toISOString()
  };
}

/**
 * Determine if event is in the past (should auto-check-in)
 */
function shouldMarkAsCheckedIn(eventDate) {
  const cutoff = new Date('2026-01-05T23:59:59Z');
  return new Date(eventDate) < cutoff;
}

/**
 * Fetch all orders for a product (with pagination and extended date window)
 */
async function getOrdersForProduct(productId, dateWindow) {
  console.log(`   Fetching orders for product ${productId}...`);
  console.log(`   Date window: ${dateWindow.after} to ${dateWindow.before}`);

  // Check if product is variable (has variations)
  const product = await woocommerce.get(`products/${productId}`);
  const isVariable = product.data.type === 'variable';
  const variations = isVariable ? product.data.variations || [] : [];

  console.log(`   Product is ${isVariable ? 'variable' : 'simple'}`);
  if (isVariable) {
    console.log(`   Found ${variations.length} variations`);
  }

  // Fetch orders with pagination
  let allOrders = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= 50) {
    const response = await woocommerce.get('orders', {
      per_page: 100,
      page,
      status: 'completed,processing,on-hold',
      after: dateWindow.after,
      before: dateWindow.before,
    });

    const orders = response.data;

    // Filter orders that contain this product or its variations
    const matchingOrders = orders.filter((order) => {
      return order.line_items?.some((item) => {
        const productMatches = item.product_id?.toString() === productId;
        const variationMatches = isVariable && variations.includes(item.variation_id);
        return productMatches || variationMatches;
      });
    });

    allOrders = allOrders.concat(matchingOrders);

    hasMore = orders.length === 100;
    page++;
  }

  console.log(`   Found ${allOrders.length} orders`);
  return allOrders;
}

/**
 * Sync attendees for a single event
 */
async function syncEventAttendees(client, event, eventIndex, totalEvents) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📅 [${eventIndex}/${totalEvents}] ${event.name}`);
  console.log(`   Date: ${event.event_date}`);
  console.log(`   Product ID: ${event.woocommerce_product_id}`);

  // Get extended date window
  const dateWindow = getExtendedDateWindow(event.event_date);
  const shouldCheckIn = shouldMarkAsCheckedIn(event.event_date);

  console.log(`   Auto check-in: ${shouldCheckIn ? 'YES (past event)' : 'NO (future event)'}`);

  // Fetch orders from WooCommerce
  let orders;
  try {
    orders = await getOrdersForProduct(
      event.woocommerce_product_id,
      dateWindow
    );
  } catch (error) {
    console.error(`   ✗ Error fetching orders:`, error.message);
    return { total: 0, created: 0, error: error.message };
  }

  let totalTickets = 0;
  let createdCount = 0;

  for (const order of orders) {
    // Filter line items for this product
    const lineItems = order.line_items?.filter((item) =>
      item.product_id?.toString() === event.woocommerce_product_id
    ) || [];

    for (const lineItem of lineItems) {
      // Extract ticket attendees
      const tickets = extractTicketAttendees(order, lineItem);

      for (const ticket of tickets) {
        totalTickets++;

        try {
          // Insert attendee
          await client.query(
            `INSERT INTO tablecn_attendees (
              id, event_id, email, first_name, last_name,
              ticket_id, woocommerce_order_id,
              booker_first_name, booker_last_name, booker_email,
              checked_in, checked_in_at,
              manually_added, locally_modified
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              generateId(),
              event.id,
              ticket.email,
              ticket.firstName,
              ticket.lastName,
              ticket.ticketId,
              order.id.toString(),
              ticket.bookerFirstName,
              ticket.bookerLastName,
              ticket.bookerEmail,
              shouldCheckIn, // Auto check-in if past event
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

/**
 * Main resync function
 */
async function resyncAllEvents() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();
  console.log('🔌 Connected to database\n');

  try {
    // WARNING: Delete all existing attendee data
    console.log('⚠️  WARNING: This will DELETE ALL existing attendee data!');
    console.log('Press Ctrl+C within 5 seconds to cancel...\n');

    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('🗑️  Truncating tablecn_attendees table...');
    await client.query('TRUNCATE tablecn_attendees CASCADE');
    console.log('✓ Attendees table cleared\n');

    // Get ALL events with WooCommerce product IDs (no LIMIT)
    const eventsResult = await client.query(
      `SELECT id, name, event_date, woocommerce_product_id
       FROM tablecn_events
       WHERE woocommerce_product_id IS NOT NULL
       ORDER BY event_date ASC`
    );

    const events = eventsResult.rows;
    console.log(`Found ${events.length} events to sync\n`);

    let totalEventsProcessed = 0;
    let totalTicketsCreated = 0;
    let totalTicketsProcessed = 0;
    let totalErrors = 0;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      try {
        const result = await syncEventAttendees(client, event, i + 1, events.length);
        totalEventsProcessed++;
        totalTicketsProcessed += result.total;
        totalTicketsCreated += result.created;

        if (result.error) {
          totalErrors++;
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
    console.log(`   Events processed: ${totalEventsProcessed}/${events.length}`);
    console.log(`   Tickets processed: ${totalTicketsProcessed}`);
    console.log(`   Tickets created: ${totalTicketsCreated}`);
    console.log(`   Errors: ${totalErrors}`);
    console.log(`\n📋 Next steps:`);
    console.log(`   1. Run: node rebuild-members.mjs`);
    console.log(`   2. Run: node verify-resync.mjs`);

  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await client.end();
  }
}

// Run the resync
resyncAllEvents();
