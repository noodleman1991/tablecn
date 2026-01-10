#!/usr/bin/env node
/**
 * Verify if changes actually happened
 */

import { createRequire } from 'module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const { Pool } = pg;
const WooCommerceRestApi = require('@woocommerce/woocommerce-rest-api').default;

const woocommerce = new WooCommerceRestApi({
  url: process.env.WOOCOMMERCE_URL,
  consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
  consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
  version: 'wc/v3',
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
});

console.log('🔍 VERIFYING CHANGES\n');
console.log('═══════════════════════════════════════════════\n');

// Check Friday event
console.log('1️⃣ Friday Night Music (NuSC6zMkqU3i):\n');

const friday = await pool.query(`
  SELECT
    COUNT(*) as count,
    array_agg(ticket_id ORDER BY ticket_id) FILTER (WHERE ticket_id IS NOT NULL) as ticket_ids
  FROM tablecn_attendees
  WHERE event_id = 'NuSC6zMkqU3i'
`);

console.log(`   Database now has: ${friday.rows[0].count} tickets`);
console.log(`   Sample ticket IDs: ${friday.rows[0].ticket_ids?.slice(0, 5).join(', ') || 'none'}`);

// Check if they're the correct format (numeric)
const sampleIds = friday.rows[0].ticket_ids?.slice(0, 5) || [];
const allNumeric = sampleIds.every(id => /^\d+$/.test(id));
console.log(`   Format: ${allNumeric ? '✅ Numeric (correct)' : '❌ Contains non-numeric (wrong)'}\n`);

// Check "In Case of Emergency" event
console.log('2️⃣ In Case of Emergency (o13bNsGrzmF4):\n');

const emergency = await pool.query(`
  SELECT
    e.id,
    e.name,
    e.event_date,
    e.woocommerce_product_id,
    COUNT(a.id) as ticket_count
  FROM tablecn_events e
  LEFT JOIN tablecn_attendees a ON a.event_id = e.id
  WHERE e.id = 'o13bNsGrzmF4'
  GROUP BY e.id, e.name, e.event_date, e.woocommerce_product_id
`);

const emergencyEvent = emergency.rows[0];
console.log(`   Name: ${emergencyEvent.name}`);
console.log(`   DB date: ${emergencyEvent.event_date}`);
console.log(`   Product ID: ${emergencyEvent.woocommerce_product_id}`);
console.log(`   Tickets: ${emergencyEvent.ticket_count}\n`);

// Check WooCommerce for real date
console.log('   Checking WooCommerce for real date...');
try {
  const response = await woocommerce.get(`products/${emergencyEvent.woocommerce_product_id}`);
  const product = response.data;

  const eventDateMeta = product.meta_data?.find(m => m.key === 'event_date');

  if (eventDateMeta) {
    const wcDateStr = eventDateMeta.value.toString();
    const year = parseInt(wcDateStr.substring(0, 4));
    const month = parseInt(wcDateStr.substring(4, 6)) - 1;
    const day = parseInt(wcDateStr.substring(6, 8));
    const wcDate = new Date(year, month, day);

    console.log(`   WooCommerce date: ${wcDate.toDateString()} (raw: ${wcDateStr})`);

    const dbDate = new Date(emergencyEvent.event_date);
    const daysDiff = Math.round((wcDate - dbDate) / (1000 * 60 * 60 * 24));

    if (daysDiff !== 0) {
      console.log(`   ❌ MISMATCH: ${daysDiff} days difference`);
    } else {
      console.log(`   ✅ Date is correct`);
    }
  } else {
    console.log(`   ⚠️  No event_date meta found in WooCommerce`);
  }

  // Check description for actual date
  if (product.short_description) {
    const desc = product.short_description.replace(/<[^>]*>/g, '');
    console.log(`   Description: ${desc.substring(0, 100)}...`);
  }
} catch (error) {
  console.error(`   ❌ Error: ${error.message}`);
}

console.log('\n');

await pool.end();