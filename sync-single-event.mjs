#!/usr/bin/env node
/**
 * Sync a SINGLE event by Event ID or Product ID
 * Usage: node sync-single-event.mjs --event=<event_id>
 *    or: node sync-single-event.mjs --product=<product_id>
 *    or: node sync-single-event.mjs --name="Event Name"
 *
 * Add --clean to delete existing tickets first
 * Add --dry-run to preview without changes
 */

import { createRequire } from 'module';
import pg from 'pg';
import { customAlphabet } from 'nanoid';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const { Pool } = pg;
const generateId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 12);

const WooCommerceRestApi = require('@woocommerce/woocommerce-rest-api').default;
const woocommerce = new WooCommerceRestApi({
  url: process.env.WOOCOMMERCE_URL,
  consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
  consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
  version: 'wc/v3',
});

// Parse args
const args = process.argv.slice(2);
const eventIdArg = args.find(a => a.startsWith('--event='))?.split('=')[1];
const productIdArg = args.find(a => a.startsWith('--product='))?.split('=')[1];
const nameArg = args.find(a => a.startsWith('--name='))?.split('=')[1];
const DRY_RUN = args.includes('--dry-run');
const CLEAN = args.includes('--clean');

if (!eventIdArg && !productIdArg && !nameArg) {
  console.error('❌ Usage: node sync-single-event.mjs --event=<id> [--clean] [--dry-run]');
  console.error('   or: node sync-single-event.mjs --product=<id> [--clean] [--dry-run]');
  console.error('   or: node sync-single-event.mjs --name="Event Name" [--clean] [--dry-run]');
  process.exit(1);
}

console.log('🎯 SINGLE EVENT SYNC\n');
console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN' : '✏️  LIVE'} | ${CLEAN ? '🧹 CLEAN' : '➕ ADDITIVE'}\n`);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
});

// Find event
let query;
let params;

if (eventIdArg) {
  query = 'SELECT * FROM tablecn_events WHERE id = $1';
  params = [eventIdArg];
} else if (productIdArg) {
  query = 'SELECT * FROM tablecn_events WHERE woocommerce_product_id = $1';
  params = [productIdArg];
} else if (nameArg) {
  query = 'SELECT * FROM tablecn_events WHERE name ILIKE $1';
  params = [`%${nameArg}%`];
}

const eventResult = await pool.query(query, params);

if (eventResult.rows.length === 0) {
  console.error('❌ Event not found');
  await pool.end();
  process.exit(1);
}

if (eventResult.rows.length > 1) {
  console.log(`⚠️  Found ${eventResult.rows.length} matching events:\n`);
  eventResult.rows.forEach((e, i) => {
    console.log(`${i + 1}. ${e.name}`);
    console.log(`   ID: ${e.id}, Product: ${e.woocommerce_product_id}\n`);
  });
  console.error('\n❌ Multiple matches - be more specific');
  await pool.end();
  process.exit(1);
}

const event = eventResult.rows[0];

console.log(`📅 Event: ${event.name}`);
console.log(`   ID: ${event.id}`);
console.log(`   Product: ${event.woocommerce_product_id}`);
console.log(`   Date: ${event.event_date}\n`);

// Count existing
const beforeCount = await pool.query(
  'SELECT COUNT(*) as count FROM tablecn_attendees WHERE event_id = $1',
  [event.id]
);
console.log(`📊 Before: ${beforeCount.rows[0].count} tickets in database\n`);

// Fetch from WooCommerce
console.log('🛒 Fetching from WooCommerce...');

let allOrders = [];
let page = 1;
let hasMore = true;

while (hasMore) {
  const response = await woocommerce.get('orders', {
    per_page: 100,
    page,
    status: 'completed,processing,on-hold,pending',
  });

  const orders = response.data.filter(order =>
    order.line_items?.some(item => item.product_id?.toString() === event.woocommerce_product_id)
  );

  allOrders.push(...orders);

  if (response.data.length < 100) {
    hasMore = false;
  } else {
    page++;
  }

  await new Promise(resolve => setTimeout(resolve, 100));
}

console.log(`   Found ${allOrders.length} orders\n`);

if (allOrders.length === 0) {
  console.log('⚠️  No orders found in WooCommerce');
  await pool.end();
  process.exit(0);
}

// Extract tickets
console.log('🎫 Extracting tickets...');
const allTickets = [];

for (const order of allOrders) {
  const lineItems = order.line_items?.filter(item =>
    item.product_id?.toString() === event.woocommerce_product_id
  ) || [];

  for (const lineItem of lineItems) {
    const ticketDataMeta = lineItem.meta_data?.find(m => m.key === '_ticket_data');
    if (!ticketDataMeta || !Array.isArray(ticketDataMeta.value)) continue;

    for (const ticketData of ticketDataMeta.value) {
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

      if (!email) continue;

      // CORRECT: Look for _ticket_id_for_{uid}
      const ticketIdKey = `_ticket_id_for_${uid}`;
      const ticketIdMeta = lineItem.meta_data?.find(m => m.key === ticketIdKey);
      const ticketId = ticketIdMeta?.value || uid;

      allTickets.push({
        ticketId,
        email,
        firstName: firstName || order.billing.first_name || '',
        lastName: lastName || order.billing.last_name || '',
        bookerFirstName: order.billing.first_name || '',
        bookerLastName: order.billing.last_name || '',
        bookerEmail: order.billing.email?.toLowerCase() || '',
        orderId: order.id,
        orderDate: order.date_created,
      });
    }
  }
}

console.log(`   Extracted ${allTickets.length} tickets\n`);

if (DRY_RUN) {
  console.log('🔍 DRY RUN - What would happen:\n');
  if (CLEAN) {
    console.log(`   1. DELETE ${beforeCount.rows[0].count} existing tickets`);
    console.log(`   2. INSERT ${allTickets.length} tickets from WooCommerce`);
    console.log(`   3. Final count: ${allTickets.length} tickets`);
  } else {
    const existing = await pool.query(
      'SELECT ticket_id FROM tablecn_attendees WHERE event_id = $1',
      [event.id]
    );
    const existingIds = new Set(existing.rows.map(r => r.ticket_id));
    const newTickets = allTickets.filter(t => !existingIds.has(t.ticketId));
    console.log(`   1. KEEP ${existing.rows.length} existing tickets`);
    console.log(`   2. ADD ${newTickets.length} new tickets`);
    console.log(`   3. Final count: ${parseInt(beforeCount.rows[0].count) + newTickets.length} tickets`);
  }
  console.log('\n✅ No changes made (dry run)');
  await pool.end();
  process.exit(0);
}

// Actually do the sync
const client = await pool.connect();
let deletedCount = 0;
let createdCount = 0;

try {
  await client.query('BEGIN');

  // CLEAN: Delete all existing
  if (CLEAN) {
    const deleteResult = await client.query(
      'DELETE FROM tablecn_attendees WHERE event_id = $1',
      [event.id]
    );
    deletedCount = deleteResult.rowCount || 0;
    console.log(`🧹 Deleted ${deletedCount} existing tickets`);
  }

  // Get existing (for ADDITIVE mode)
  let existingTicketIds = new Set();
  if (!CLEAN) {
    const existing = await client.query(
      'SELECT ticket_id FROM tablecn_attendees WHERE event_id = $1',
      [event.id]
    );
    existingTicketIds = new Set(existing.rows.map(r => r.ticket_id));
  }

  // Insert tickets
  const shouldCheckIn = new Date(event.event_date) < new Date();

  for (const ticket of allTickets) {
    if (!CLEAN && existingTicketIds.has(ticket.ticketId)) {
      continue; // Skip existing in ADDITIVE mode
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
  console.log(`✅ Created ${createdCount} tickets`);

} catch (error) {
  await client.query('ROLLBACK');
  console.error(`❌ Failed: ${error.message}`);
  await pool.end();
  process.exit(1);
} finally {
  client.release();
}

// Verify
const afterCount = await pool.query(
  'SELECT COUNT(*) as count FROM tablecn_attendees WHERE event_id = $1',
  [event.id]
);

console.log(`\n📊 After: ${afterCount.rows[0].count} tickets in database`);
console.log(`\n✅ Sync complete!`);

await pool.end();
