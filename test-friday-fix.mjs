#!/usr/bin/env node
/**
 * Test the fix on Friday Night Music event only
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

const DRY_RUN = process.argv.includes('--dry-run');
const CLEAN_MODE = process.argv.includes('--clean');

console.log('🧪 Testing Fix on Friday Night Music Event\n');
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | ${CLEAN_MODE ? 'CLEAN' : 'ADDITIVE'}\n`);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
});

// Find Friday event
const eventResult = await pool.query(`
  SELECT id, name, woocommerce_product_id, event_date
  FROM tablecn_events
  WHERE name ILIKE '%friday%music%kareem%'
`);

if (eventResult.rows.length === 0) {
  console.error('Event not found');
  process.exit(1);
}

const event = eventResult.rows[0];
console.log(`Event: ${event.name}`);
console.log(`Product: ${event.woocommerce_product_id}\n`);

// Current state
const currentTickets = await pool.query(`
  SELECT COUNT(*) as count FROM tablecn_attendees WHERE event_id = $1
`, [event.id]);
console.log(`Current DB tickets: ${currentTickets.rows[0].count}\n`);

// Fetch from WooCommerce
console.log('Fetching from WooCommerce...');
const response = await woocommerce.get('orders', {
  per_page: 100,
  status: 'completed,processing,on-hold,pending',
});

const orders = response.data.filter(order =>
  order.line_items?.some(item => item.product_id?.toString() === event.woocommerce_product_id)
);

console.log(`Found ${orders.length} orders\n`);

// Extract tickets WITH CORRECT LOGIC
const extractedTickets = [];
for (const order of orders) {
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

      // CRITICAL: Look for _ticket_id_for_{uid}
      const ticketIdKey = `_ticket_id_for_${uid}`;
      const ticketIdMeta = lineItem.meta_data?.find(m => m.key === ticketIdKey);
      const ticketId = ticketIdMeta?.value || uid;

      extractedTickets.push({
        ticketId,
        email,
        firstName,
        lastName,
        orderId: order.id,
        orderDate: order.date_created,
        uid, // For comparison
      });
    }
  }
}

console.log(`Extracted ${extractedTickets.length} tickets\n`);
console.log('Sample tickets (first 5):');
extractedTickets.slice(0, 5).forEach(t => {
  console.log(`  ${t.ticketId}: ${t.email} (${t.firstName} ${t.lastName})`);
  if (t.ticketId !== t.uid) {
    console.log(`    ✓ Correct format (not using uid)`);
  } else {
    console.log(`    ⚠️  Using uid as ticketId`);
  }
});

console.log(`\n📊 COMPARISON:\n`);
console.log(`WooCommerce source of truth: 29 tickets`);
console.log(`Extracted from API: ${extractedTickets.length} tickets`);
console.log(`Database has: ${currentTickets.rows[0].count} tickets\n`);

if (extractedTickets.length === 29) {
  console.log('✅ Extraction is CORRECT\n');
} else {
  console.log(`❌ Extraction mismatch: expected 29, got ${extractedTickets.length}\n`);
}

// Check ticket ID format
const allUseCorrectFormat = extractedTickets.every(t => /^\d+$/.test(t.ticketId));
console.log(`Ticket ID format: ${allUseCorrectFormat ? '✅ Numeric (correct)' : '❌ Contains non-numeric (wrong)'}\n`);

if (DRY_RUN) {
  console.log('🔍 DRY RUN - No changes made');
} else if (CLEAN_MODE) {
  console.log('🧹 CLEAN MODE - Would delete all and resync');
  console.log(`   Delete: ${currentTickets.rows[0].count} tickets`);
  console.log(`   Insert: ${extractedTickets.length} tickets`);
} else {
  console.log('➕ ADDITIVE MODE - Would add missing only');
}

await pool.end();
