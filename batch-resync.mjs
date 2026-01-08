#!/usr/bin/env node
/**
 * Batch Resync Script - Optimized
 *
 * Strategy: Fetch all WooCommerce orders ONCE, then match to events
 * This is much faster than fetching orders for each event individually
 */

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
        orderId: order.id,
        orderDate: order.date_created,
        bookerFirstName: order.billing.first_name || '',
        bookerLastName: order.billing.last_name || '',
        bookerEmail: order.billing.email || '',
      });
    }
  }

  return attendees;
}

function shouldMarkAsCheckedIn(eventDate) {
  const cutoff = new Date();
  cutoff.setUTCHours(23, 59, 59, 999);
  return new Date(eventDate) < cutoff;
}

async function fetchAllOrders() {
  console.log('📦 Fetching ALL WooCommerce orders...');
  console.log('   This may take several minutes...\n');

  let allOrders = [];
  let page = 1;
  let hasMore = true;
  let totalFetched = 0;

  while (hasMore && page <= 50) {
    try {
      const response = await woocommerce.get('orders', {
        per_page: 100,
        page,
        status: 'completed,processing,on-hold',
      });

      const orders = response.data;
      allOrders = allOrders.concat(orders);
      totalFetched += orders.length;

      if (page % 5 === 0) {
        console.log(`   Fetched ${totalFetched} orders (page ${page})...`);
      }

      hasMore = orders.length === 100;
      page++;

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`   ⚠️  Error on page ${page}:`, error.message);
      hasMore = false;
    }
  }

  console.log(`\n✅ Fetched ${totalFetched} total orders`);
  return allOrders;
}

function buildProductToOrdersMap(orders) {
  console.log('\n📊 Building product-to-orders mapping...');

  const productMap = new Map();

  for (const order of orders) {
    if (!order.line_items) continue;

    for (const item of order.line_items) {
      const productId = item.product_id?.toString();
      if (!productId) continue;

      if (!productMap.has(productId)) {
        productMap.set(productId, []);
      }
      productMap.get(productId).push({ order, lineItem: item });
    }
  }

  console.log(`   Mapped ${productMap.size} unique products`);
  return productMap;
}

async function batchResync() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });

  await client.connect();
  console.log('🔌 Connected to database\n');

  try {
    // Step 1: Fetch all WooCommerce orders
    const allOrders = await fetchAllOrders();

    // Step 2: Build product-to-orders map
    const productMap = buildProductToOrdersMap(allOrders);

    // Step 3: Get all events from database
    const eventsResult = await client.query(
      `SELECT id, name, event_date, woocommerce_product_id
       FROM tablecn_events
       WHERE woocommerce_product_id IS NOT NULL
       ORDER BY event_date ASC`
    );

    const events = eventsResult.rows;
    console.log(`\n📅 Processing ${events.length} events\n`);
    console.log('━'.repeat(80));

    let totalEventsProcessed = 0;
    let totalTicketsCreated = 0;
    let totalTicketsProcessed = 0;

    // Step 4: Process each event
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const eventNum = i + 1;

      console.log(`\n[${eventNum}/${events.length}] ${event.name}`);
      console.log(`   Date: ${event.event_date}`);
      console.log(`   Product ID: ${event.woocommerce_product_id}`);

      const shouldCheckIn = shouldMarkAsCheckedIn(event.event_date);

      // Get orders for this product from our map
      const orderEntries = productMap.get(event.woocommerce_product_id) || [];

      let ticketsForEvent = [];
      for (const { order, lineItem } of orderEntries) {
        const tickets = extractTicketAttendees(order, lineItem);
        ticketsForEvent = ticketsForEvent.concat(tickets);
      }

      console.log(`   Found ${ticketsForEvent.length} tickets`);

      let createdCount = 0;

      for (const ticket of ticketsForEvent) {
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
        } catch (error) {
          console.error(`   ✗ Error inserting ticket ${ticket.ticketId}:`, error.message);
        }
      }

      console.log(`   ✓ Created ${createdCount} new tickets`);

      totalEventsProcessed++;
      totalTicketsProcessed += ticketsForEvent.length;
      totalTicketsCreated += createdCount;

      // Progress checkpoint every 10 events
      if (eventNum % 10 === 0) {
        console.log(`\n💾 Progress: ${eventNum}/${events.length} events processed`);
      }
    }

    console.log('\n' + '━'.repeat(80));
    console.log('\n✅ Batch resync complete!');
    console.log(`   Events processed: ${totalEventsProcessed}`);
    console.log(`   Tickets processed: ${totalTicketsProcessed}`);
    console.log(`   Tickets created: ${totalTicketsCreated}`);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the batch resync
batchResync();
