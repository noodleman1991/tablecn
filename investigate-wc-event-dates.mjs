#!/usr/bin/env node
/**
 * INVESTIGATE WOOCOMMERCE EVENT DATE STRUCTURE
 *
 * Purpose: Understand how event dates are stored in WooCommerce
 * - Check product metadata for date fields
 * - Check product attributes
 * - Compare with database event_date
 * - Find the source of truth for event dates
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

console.log('🔍 INVESTIGATING WOOCOMMERCE EVENT DATE STRUCTURE\n');
console.log('═══════════════════════════════════════════════\n');

// Sample 5 events with known issues
const sampleEvents = await pool.query(`
  SELECT
    e.id,
    e.name,
    e.event_date,
    e.woocommerce_product_id,
    MIN(a.woocommerce_order_date) as first_purchase
  FROM tablecn_events e
  LEFT JOIN tablecn_attendees a ON a.event_id = e.id
  WHERE e.woocommerce_product_id IS NOT NULL
  GROUP BY e.id, e.name, e.event_date, e.woocommerce_product_id
  ORDER BY e.event_date DESC
  LIMIT 5
`);

console.log(`Checking ${sampleEvents.rows.length} sample events...\n`);

for (const event of sampleEvents.rows) {
  console.log('━'.repeat(50));
  console.log(`\n📅 ${event.name.substring(0, 60)}`);
  console.log(`   Product ID: ${event.woocommerce_product_id}`);
  console.log(`   DB event_date: ${event.event_date}`);
  console.log(`   First purchase: ${event.first_purchase || 'No tickets'}\n`);

  try {
    // Fetch product from WooCommerce
    const response = await woocommerce.get(`products/${event.woocommerce_product_id}`);
    const product = response.data;

    console.log('📦 WooCommerce Product Data:\n');

    // Check name
    console.log(`   Name: ${product.name}`);

    // Check type
    console.log(`   Type: ${product.type}`);

    // Check date fields
    console.log(`   Date created: ${product.date_created}`);
    console.log(`   Date modified: ${product.date_modified}`);

    // Check meta data
    if (product.meta_data && product.meta_data.length > 0) {
      console.log(`\n   📋 Meta Data (${product.meta_data.length} fields):`);

      // Look for date-related meta
      const dateRelated = product.meta_data.filter(m =>
        m.key.toLowerCase().includes('date') ||
        m.key.toLowerCase().includes('time') ||
        m.key.toLowerCase().includes('event') ||
        m.key.toLowerCase().includes('start') ||
        m.key.toLowerCase().includes('end')
      );

      if (dateRelated.length > 0) {
        console.log('   📅 Date-related meta:');
        dateRelated.forEach(m => {
          console.log(`      ${m.key}: ${JSON.stringify(m.value)}`);
        });
      } else {
        console.log('   ⚠️  No date-related meta found');
      }

      // Show first 10 meta fields to understand structure
      console.log('\n   📋 All meta fields (first 10):');
      product.meta_data.slice(0, 10).forEach(m => {
        const valuePreview = typeof m.value === 'string' && m.value.length > 50
          ? m.value.substring(0, 50) + '...'
          : JSON.stringify(m.value);
        console.log(`      ${m.key}: ${valuePreview}`);
      });
    } else {
      console.log('\n   ⚠️  No meta data');
    }

    // Check attributes
    if (product.attributes && product.attributes.length > 0) {
      console.log(`\n   📋 Attributes (${product.attributes.length}):`);
      product.attributes.forEach(attr => {
        console.log(`      ${attr.name}: ${attr.options?.join(', ') || 'N/A'}`);
      });
    }

    // Check categories
    if (product.categories && product.categories.length > 0) {
      console.log(`\n   📂 Categories:`);
      product.categories.forEach(cat => {
        console.log(`      ${cat.name}`);
      });
    }

    // Check short description (might contain date)
    if (product.short_description) {
      const shortDesc = product.short_description.replace(/<[^>]*>/g, '').substring(0, 100);
      console.log(`\n   📝 Short description:`);
      console.log(`      ${shortDesc}...`);
    }

    // Check if there's a date in the product name
    const nameHasDate = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2}|January|February|March|April|May|June|July|August|September|October|November|December/i.test(product.name);
    if (nameHasDate) {
      console.log(`\n   ℹ️  Product name contains a date pattern`);
    }

  } catch (error) {
    console.error(`   ❌ Error fetching product: ${error.message}`);
  }

  console.log('');
  await new Promise(resolve => setTimeout(resolve, 500));
}

console.log('━'.repeat(50));
console.log('\n📊 SUMMARY\n');
console.log('To find the correct event date, we need to identify:');
console.log('1. Which meta_data field contains the actual event date/time');
console.log('2. OR if the date is in product name/description');
console.log('3. OR if it comes from a ticketing plugin meta field\n');

console.log('💡 NEXT STEPS:\n');
console.log('1. Review the meta_data fields above');
console.log('2. Identify the correct field for event date');
console.log('3. Create a script that uses THAT field to validate dates\n');

await pool.end();
