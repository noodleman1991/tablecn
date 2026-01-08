// Verify Event Dates Script
// Compares database event dates with WooCommerce event_date metadata

import { createRequire } from 'module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const { Client } = pg;

const WooCommerceRestApi = require('@woocommerce/woocommerce-rest-api').default;

const woocommerce = new WooCommerceRestApi({
  url: process.env.WOOCOMMERCE_URL,
  consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
  consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
  version: 'wc/v3',
});

function parseYYYYMMDD(dateStr) {
  if (!/^\d{8}$/.test(dateStr)) return null;

  const year = parseInt(dateStr.substring(0, 4), 10);
  const month = parseInt(dateStr.substring(4, 6), 10) - 1;
  const day = parseInt(dateStr.substring(6, 8), 10);

  return new Date(year, month, day);
}

function datesMatch(dbDate, wooDate) {
  const db = new Date(dbDate);
  const woo = parseYYYYMMDD(wooDate);

  if (!woo) return false;

  return db.getFullYear() === woo.getFullYear() &&
         db.getMonth() === woo.getMonth() &&
         db.getDate() === woo.getDate();
}

async function verifyEventDates() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();
  console.log('🔌 Connected to database\n');

  try {
    // Get all events with WooCommerce product IDs
    const eventsResult = await client.query(`
      SELECT id, name, event_date, woocommerce_product_id
      FROM tablecn_events
      WHERE woocommerce_product_id IS NOT NULL
      ORDER BY event_date DESC
      LIMIT 50
    `);

    const events = eventsResult.rows;
    console.log(`📊 Checking ${events.length} most recent events...\n`);

    let matchCount = 0;
    let mismatchCount = 0;
    let errorCount = 0;
    const mismatches = [];

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      try {
        // Fetch from WooCommerce
        const response = await woocommerce.get(`products/${event.woocommerce_product_id}`);
        const product = response.data;

        const eventDateMeta = product.meta_data?.find(m => m.key === 'event_date');

        if (!eventDateMeta?.value) {
          console.log(`⚠️  [${i + 1}/${events.length}] No event_date metadata: ${event.name}`);
          errorCount++;
          continue;
        }

        const matches = datesMatch(event.event_date, eventDateMeta.value);

        if (matches) {
          matchCount++;
          console.log(`✅ [${i + 1}/${events.length}] ${event.name}`);
        } else {
          mismatchCount++;
          const dbDate = new Date(event.event_date).toDateString();
          const wooDate = parseYYYYMMDD(eventDateMeta.value)?.toDateString() || 'Invalid';

          console.log(`❌ [${i + 1}/${events.length}] MISMATCH: ${event.name}`);
          console.log(`   DB:  ${dbDate}`);
          console.log(`   WC:  ${wooDate} (${eventDateMeta.value})`);

          mismatches.push({
            name: event.name,
            productId: event.woocommerce_product_id,
            dbDate,
            wooDate,
            wooDateRaw: eventDateMeta.value,
          });
        }

        // Rate limiting
        if (i < events.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }

      } catch (error) {
        console.error(`❌ [${i + 1}/${events.length}] Error fetching ${event.name}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n📊 VERIFICATION SUMMARY\n');
    console.log(`✅ Matching dates: ${matchCount}`);
    console.log(`❌ Mismatched dates: ${mismatchCount}`);
    console.log(`⚠️  Errors/Missing metadata: ${errorCount}`);
    console.log(`📋 Total checked: ${events.length}`);

    if (mismatches.length > 0) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('\n❌ EVENTS WITH DATE MISMATCHES:\n');

      mismatches.forEach((m, i) => {
        console.log(`${i + 1}. ${m.name}`);
        console.log(`   Product ID: ${m.productId}`);
        console.log(`   Database: ${m.dbDate}`);
        console.log(`   WooCommerce: ${m.wooDate} (${m.wooDateRaw})`);
        console.log('');
      });

      console.log('💡 To fix these mismatches, re-run: node discover-historical-events.mjs');
    } else if (matchCount > 0) {
      console.log('\n✅ All event dates match WooCommerce! No action needed.');
    }

  } catch (error) {
    console.error('Fatal error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

verifyEventDates();