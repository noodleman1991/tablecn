// Comprehensive resync script for all events (including past)
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
 * Fetch all orders for a product (with pagination)
 */
async function getOrdersForProduct(productId, eventDate) {
  console.log(`   Fetching orders for product ${productId}...`);

  // Date filter: 60 days before event to 7 days after
  let dateParams = {};
  if (eventDate) {
    const after = new Date(eventDate);
    after.setDate(after.getDate() - 60);
    const before = new Date(eventDate);
    before.setDate(before.getDate() + 7);

    dateParams = {
      after: after.toISOString(),
      before: before.toISOString(),
    };
  }

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
      ...dateParams,
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
async function syncEventAttendees(client, event) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📅 ${event.name}`);
  console.log(`   Date: ${event.event_date}`);
  console.log(`   Product ID: ${event.woocommerce_product_id}`);

  // Fetch orders from WooCommerce
  const orders = await getOrdersForProduct(
    event.woocommerce_product_id,
    event.event_date
  );

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

        // Check if ticket already exists
        const existing = await client.query(
          'SELECT id FROM tablecn_attendees WHERE ticket_id = $1',
          [ticket.ticketId]
        );

        if (existing.rows.length === 0) {
          // Create new attendee
          await client.query(
            `INSERT INTO tablecn_attendees (
              id, event_id, email, first_name, last_name,
              ticket_id, woocommerce_order_id,
              booker_first_name, booker_last_name, booker_email,
              checked_in, checked_in_at,
              manually_added, locally_modified
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              generateId(), // Generate unique ID
              event.id,
              ticket.email,
              ticket.firstName,
              ticket.lastName,
              ticket.ticketId,
              order.id.toString(),
              ticket.bookerFirstName, // Booker first name
              ticket.bookerLastName,  // Booker last name
              ticket.bookerEmail,     // Booker email
              false, // Not checked in
              null,
              false, // Not manually added
              false, // Not locally modified
            ]
          );
          createdCount++;
        } else {
          // Update existing attendee with booker information
          // Only update booker fields if they are currently NULL
          const existingId = existing.rows[0].id;
          await client.query(
            `UPDATE tablecn_attendees
             SET booker_first_name = COALESCE(booker_first_name, $1),
                 booker_last_name = COALESCE(booker_last_name, $2),
                 booker_email = COALESCE(booker_email, $3)
             WHERE id = $4`,
            [
              ticket.bookerFirstName,
              ticket.bookerLastName,
              ticket.bookerEmail,
              existingId
            ]
          );
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
    // Get all events with WooCommerce product IDs
    const eventsResult = await client.query(
      `SELECT id, name, event_date, woocommerce_product_id
       FROM tablecn_events
       WHERE woocommerce_product_id IS NOT NULL
       ORDER BY event_date DESC
       LIMIT 10`
    );

    const events = eventsResult.rows;
    console.log(`Found ${events.length} events to sync (last 10)\n`);

    let totalEventsProcessed = 0;
    let totalTicketsCreated = 0;
    let totalTicketsProcessed = 0;

    for (const event of events) {
      try {
        const result = await syncEventAttendees(client, event);
        totalEventsProcessed++;
        totalTicketsProcessed += result.total;
        totalTicketsCreated += result.created;
      } catch (error) {
        console.error(`   ✗ Error syncing event:`, error.message);
      }
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`\n✅ Resync complete!`);
    console.log(`   Events processed: ${totalEventsProcessed}`);
    console.log(`   Tickets processed: ${totalTicketsProcessed}`);
    console.log(`   Tickets created: ${totalTicketsCreated}`);

  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await client.end();
  }
}

resyncAllEvents();
