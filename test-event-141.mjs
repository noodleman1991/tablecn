// Test script to debug Event 141 sync logic
import { createRequire } from 'module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const { Pool } = pg;
const WooCommerceRestApi = require('@woocommerce/woocommerce-rest-api').default;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const woocommerce = new WooCommerceRestApi({
  url: process.env.WOOCOMMERCE_URL,
  consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
  consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
  version: 'wc/v3',
});

async function testEvent141() {
  console.log('🔍 Testing Event 141 Sync Logic\n');

  // Get events exactly how the script does
  const eventsResult = await pool.query(`
    SELECT id, name, event_date, woocommerce_product_id
    FROM tablecn_events
    WHERE woocommerce_product_id IS NOT NULL
    ORDER BY event_date ASC
  `);

  const events = eventsResult.rows;
  console.log(`Total events: ${events.length}`);

  // Get event at position 141 (array index 140)
  const eventIndex = 140; // 141-1 for zero-based array
  const event = events[eventIndex];

  console.log(`\nEvent at position 141 (index ${eventIndex}):`);
  console.log(`  ID: ${event.id}`);
  console.log(`  Name: ${event.name}`);
  console.log(`  Product: ${event.woocommerce_product_id}`);
  console.log(`  Date: ${event.event_date}`);

  // Check what duplicate query returns
  console.log(`\n🔍 Running duplicate check query...`);
  const existingTickets = await pool.query(
    `SELECT ticket_id FROM tablecn_attendees WHERE event_id = $1`,
    [event.id]
  );

  console.log(`Query: SELECT ticket_id FROM tablecn_attendees WHERE event_id = '${event.id}'`);
  console.log(`Result: ${existingTickets.rows.length} rows`);

  if (existingTickets.rows.length > 0) {
    console.log(`\n❌ FOUND TICKETS! This is why script thinks they exist:`);
    console.log(`Sample ticket_ids:`, existingTickets.rows.slice(0, 5).map(r => r.ticket_id));

    // Let's see which event these tickets actually belong to
    const ticketDetails = await pool.query(`
      SELECT
        a.ticket_id,
        a.event_id,
        e.name as event_name,
        e.woocommerce_product_id
      FROM tablecn_attendees a
      JOIN tablecn_events e ON a.event_id = e.id
      WHERE a.event_id = $1
      LIMIT 5
    `, [event.id]);

    console.log(`\nTicket details:`);
    ticketDetails.rows.forEach(t => {
      console.log(`  - Ticket ${t.ticket_id}: ${t.event_name} (product: ${t.woocommerce_product_id})`);
    });
  } else {
    console.log(`\n✅ No tickets found - duplicate check should pass`);
  }

  // Now let's fetch from WooCommerce
  console.log(`\n🛒 Fetching orders from WooCommerce for product ${event.woocommerce_product_id}...`);

  try {
    let allOrders = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 5) {
      const response = await woocommerce.get('orders', {
        per_page: 100,
        page,
        status: 'completed,processing,on-hold',
      });

      const orders = response.data;
      const filteredOrders = orders.filter(order =>
        order.line_items?.some(item => item.product_id?.toString() === event.woocommerce_product_id)
      );

      allOrders.push(...filteredOrders);

      if (orders.length < 100) {
        hasMore = false;
      } else {
        page++;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`Found ${allOrders.length} orders for product ${event.woocommerce_product_id}`);

    // Extract ticket count
    let totalTickets = 0;
    for (const order of allOrders) {
      const lineItems = order.line_items?.filter((item) =>
        item.product_id?.toString() === event.woocommerce_product_id
      ) || [];

      for (const lineItem of lineItems) {
        const ticketDataMeta = lineItem.meta_data?.find((m) => m.key === '_ticket_data');
        if (ticketDataMeta && Array.isArray(ticketDataMeta.value)) {
          totalTickets += ticketDataMeta.value.length;
        }
      }
    }

    console.log(`Total tickets in WooCommerce: ${totalTickets}`);

  } catch (error) {
    console.error(`Error fetching from WooCommerce:`, error.message);
  }

  await pool.end();
}

testEvent141().catch(console.error);
