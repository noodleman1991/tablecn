#!/usr/bin/env node
/**
 * Test Single Event Sync
 *
 * Tests the sync process for a single WooCommerce product to verify:
 * - All tickets are fetched (no date filtering issues)
 * - Network retry logic works
 * - Order dates are captured correctly
 *
 * Usage: node test-single-event.mjs [woocommerce_product_id]
 * Example: node test-single-event.mjs 4382
 */

import { createRequire } from 'module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const { Client } = pg;

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
      });
    }
  }

  return attendees;
}

async function getOrdersForProduct(productId) {
  let allOrders = [];
  let page = 1;
  let hasMore = true;

  console.log(`\n📦 Fetching orders for product ${productId}...`);

  while (hasMore && page <= 50) {
    const params = {
      per_page: 100,
      page,
      status: 'completed,processing,on-hold',
      // NO DATE FILTER - fetch ALL orders
    };

    const response = await woocommerce.get('orders', params);
    const orders = response.data;

    const matchingOrders = orders.filter((order) => {
      return order.line_items?.some((item) => {
        return item.product_id?.toString() === productId;
      });
    });

    allOrders = allOrders.concat(matchingOrders);
    console.log(`   Page ${page}: ${matchingOrders.length} matching orders (${orders.length} total)`);

    hasMore = orders.length === 100;
    page++;
  }

  return allOrders;
}

async function testSingleEvent(productId) {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();

  try {
    console.log('━'.repeat(80));
    console.log(`🧪 Testing Product ID: ${productId}`);
    console.log('━'.repeat(80));

    // Find event in database
    const eventResult = await client.query(
      `SELECT id, name, event_date, woocommerce_product_id
       FROM tablecn_events
       WHERE woocommerce_product_id = $1`,
      [productId]
    );

    if (eventResult.rows.length === 0) {
      console.error(`\n❌ No event found with WooCommerce product ID: ${productId}`);
      console.log('\n💡 Available events:');
      const allEvents = await client.query(
        `SELECT name, event_date, woocommerce_product_id
         FROM tablecn_events
         WHERE woocommerce_product_id IS NOT NULL
         ORDER BY event_date DESC
         LIMIT 10`
      );
      allEvents.rows.forEach(e => {
        console.log(`   ${e.woocommerce_product_id}: "${e.name}" (${e.event_date})`);
      });
      return;
    }

    const event = eventResult.rows[0];
    console.log(`\n📅 Event: "${event.name}"`);
    console.log(`   Date: ${event.event_date}`);
    console.log(`   Event ID: ${event.id}`);

    // Get current database count
    const dbCountResult = await client.query(
      `SELECT COUNT(*) as count FROM tablecn_attendees WHERE event_id = $1`,
      [event.id]
    );
    const dbCount = parseInt(dbCountResult.rows[0].count);

    console.log(`\n📊 Current Database State:`);
    console.log(`   Attendees in DB: ${dbCount}`);

    // Fetch from WooCommerce
    const orders = await getOrdersForProduct(productId);
    console.log(`\n✅ Fetched ${orders.length} orders from WooCommerce`);

    // Extract all tickets
    let allTickets = [];
    let orderDetails = [];

    for (const order of orders) {
      const lineItems = order.line_items?.filter((item) =>
        item.product_id?.toString() === productId
      ) || [];

      for (const lineItem of lineItems) {
        const tickets = extractTicketAttendees(order, lineItem);
        allTickets = allTickets.concat(tickets);

        if (tickets.length > 0) {
          orderDetails.push({
            orderId: order.id,
            orderDate: new Date(order.date_created),
            ticketCount: tickets.length,
            booker: `${order.billing.first_name} ${order.billing.last_name}`,
            tickets: tickets,
          });
        }
      }
    }

    console.log(`\n🎟️  Total Tickets Found: ${allTickets.length}`);
    console.log(`   Orders with tickets: ${orderDetails.length}`);

    // Sort by order date
    orderDetails.sort((a, b) => a.orderDate - b.orderDate);

    console.log(`\n📋 Order Details (chronological):`);
    console.log('─'.repeat(80));
    for (const detail of orderDetails) {
      console.log(`   Order #${detail.orderId} | ${detail.orderDate.toISOString().split('T')[0]} | ${detail.ticketCount} ticket(s) | ${detail.booker}`);
      for (const ticket of detail.tickets) {
        console.log(`      • ${ticket.email} (${ticket.firstName} ${ticket.lastName})`);
      }
    }
    console.log('─'.repeat(80));

    // Date range analysis
    if (orderDetails.length > 0) {
      const firstOrder = orderDetails[0].orderDate;
      const lastOrder = orderDetails[orderDetails.length - 1].orderDate;
      const eventDate = new Date(event.event_date);

      const daysBeforeEvent = Math.floor((eventDate - firstOrder) / (1000 * 60 * 60 * 24));

      console.log(`\n📅 Purchase Timeline:`);
      console.log(`   Event date: ${eventDate.toISOString().split('T')[0]}`);
      console.log(`   First order: ${firstOrder.toISOString().split('T')[0]} (${daysBeforeEvent} days before event)`);
      console.log(`   Last order: ${lastOrder.toISOString().split('T')[0]}`);

      if (daysBeforeEvent > 180) {
        console.log(`   ⚠️  NOTE: First order was ${daysBeforeEvent} days before event`);
        console.log(`           Old 180-day window would have missed this!`);
      }
    }

    // Compare with database
    console.log(`\n🔍 Comparison:`);
    console.log(`   WooCommerce: ${allTickets.length} tickets`);
    console.log(`   Database: ${dbCount} tickets`);

    if (allTickets.length === dbCount) {
      console.log(`   ✅ PERFECT MATCH!`);
    } else {
      console.log(`   ⚠️  MISMATCH: Missing ${allTickets.length - dbCount} tickets in database`);
    }

    console.log('\n━'.repeat(80));
    console.log('✅ Test Complete');
    console.log('\n💡 Next Steps:');
    if (allTickets.length > dbCount) {
      console.log('   Run full resync: node resume-resync.mjs 1');
    } else {
      console.log('   Database is complete for this event!');
    }
    console.log('━'.repeat(80));

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
  } finally {
    await client.end();
  }
}

// Get product ID from command line
const productId = process.argv[2];

if (!productId) {
  console.error('Usage: node test-single-event.mjs [woocommerce_product_id]');
  console.error('Example: node test-single-event.mjs 4382');
  process.exit(1);
}

testSingleEvent(productId);
