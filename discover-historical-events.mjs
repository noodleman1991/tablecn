// Discover Historical Events Script
// Fetches ALL events from WooCommerce (2023 onwards) and creates them in the database
// This should be run BEFORE full-historical-resync.mjs

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
 * Extract event date from product name or metadata
 * Common formats: "Event Name - Jan 15, 2023" or metadata
 */
function extractEventDate(product) {
  // Try to find date in product name (e.g., "Event - Jan 15, 2023")
  const nameMatch = product.name.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (nameMatch) {
    const [, month, day, year] = nameMatch;
    const date = new Date(`${month} ${day}, ${year}`);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // Try to get from product metadata
  const dateMeta = product.meta_data?.find(m =>
    ['event_date', '_event_date', 'date'].includes(m.key)
  );

  if (dateMeta?.value) {
    const date = new Date(dateMeta.value);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // Fallback: use product created date as approximation
  return new Date(product.date_created);
}

/**
 * Check if product is likely an event (vs regular product)
 */
function isEventProduct(product) {
  const name = product.name.toLowerCase();

  // Skip if it's clearly not an event
  const nonEventKeywords = ['merchandise', 'book', 'membership', 'donation', 'gift'];
  if (nonEventKeywords.some(keyword => name.includes(keyword))) {
    return false;
  }

  // Check if it has event-related categories
  const hasEventCategory = product.categories?.some(cat => {
    const catName = cat.name.toLowerCase();
    return catName.includes('event') || catName.includes('workshop') || catName.includes('seminar');
  });

  if (hasEventCategory) return true;

  // Check if product has ticket/event-related metadata
  const hasEventMeta = product.meta_data?.some(m =>
    ['event_date', '_event_date', 'tickets', '_ticket_data'].includes(m.key)
  );

  if (hasEventMeta) return true;

  // Default: assume it's an event if it's a simple or variable product
  return ['simple', 'variable'].includes(product.type);
}

/**
 * Fetch all products from WooCommerce (with pagination)
 */
async function fetchAllProducts(afterDate) {
  console.log('🔍 Fetching products from WooCommerce...');
  console.log(`   Date filter: After ${afterDate.toISOString().split('T')[0]}\n`);

  let allProducts = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= 100) {
    console.log(`   Fetching page ${page}...`);

    const response = await woocommerce.get('products', {
      per_page: 100,
      page,
      status: 'publish',
      after: afterDate.toISOString(),
    });

    const products = response.data;
    allProducts = allProducts.concat(products);

    hasMore = products.length === 100;
    page++;

    // Rate limiting
    if (hasMore) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  console.log(`   Found ${allProducts.length} total products\n`);
  return allProducts;
}

/**
 * Discover and import historical events
 */
async function discoverHistoricalEvents() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();
  console.log('🔌 Connected to database\n');

  try {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📅 DISCOVER HISTORICAL EVENTS FROM WOOCOMMERCE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Fetch products from 2023 onwards
    const startDate = new Date('2023-01-01');
    const products = await fetchAllProducts(startDate);

    // Filter to event products only
    console.log('🎯 Filtering event products...');
    const eventProducts = products.filter(isEventProduct);
    console.log(`   Found ${eventProducts.length} event products\n`);

    let createdCount = 0;
    let skippedCount = 0;
    let updatedCount = 0;

    console.log('📝 Processing events...\n');

    for (let i = 0; i < eventProducts.length; i++) {
      const product = eventProducts[i];
      const eventDate = extractEventDate(product);

      if ((i + 1) % 10 === 0) {
        console.log(`   Processing ${i + 1}/${eventProducts.length}...`);
      }

      // Check if event already exists
      const existingEvent = await client.query(
        `SELECT id, name FROM tablecn_events
         WHERE woocommerce_product_id = $1`,
        [product.id.toString()]
      );

      if (existingEvent.rows.length > 0) {
        // Update existing event name if changed
        const existing = existingEvent.rows[0];
        if (existing.name !== product.name) {
          await client.query(
            `UPDATE tablecn_events
             SET name = $1, event_date = $2, updated_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [product.name, eventDate, existing.id]
          );
          updatedCount++;
          console.log(`   ✓ Updated: ${product.name} (${eventDate.toISOString().split('T')[0]})`);
        } else {
          skippedCount++;
        }
        continue;
      }

      // Create new event
      await client.query(
        `INSERT INTO tablecn_events (
          id, name, event_date, woocommerce_product_id, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          generateId(),
          product.name,
          eventDate,
          product.id.toString(),
        ]
      );

      createdCount++;
      console.log(`   ✓ Created: ${product.name} (${eventDate.toISOString().split('T')[0]})`);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n✅ Event discovery complete!');
    console.log(`   Events created: ${createdCount}`);
    console.log(`   Events updated: ${updatedCount}`);
    console.log(`   Events skipped (already exist): ${skippedCount}`);
    console.log(`   Total processed: ${eventProducts.length}`);
    console.log('\n📋 Next steps:');
    console.log('   1. Review events in your database');
    console.log('   2. Run: node cleanup-duplicates.mjs');
    console.log('   3. Run: pnpm db:generate && pnpm db:push');
    console.log('   4. Run: node full-historical-resync.mjs');

  } catch (error) {
    console.error('Fatal error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the discovery
discoverHistoricalEvents();
