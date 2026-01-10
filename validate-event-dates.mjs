#!/usr/bin/env node
/**
 * VALIDATE EVENT DATES AGAINST WOOCOMMERCE
 *
 * Based on ACTUAL WooCommerce data structure:
 * - WooCommerce stores event date in meta_data field: "event_date" (format: YYYYMMDD)
 * - Compare this with database event_date field
 * - Report discrepancies
 *
 * DOES NOT make assumptions from purchase dates!
 */

import { createRequire } from 'module';
import pg from 'pg';
import fs from 'fs';

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

const DRY_RUN = process.argv.includes('--dry-run');
const FIX = process.argv.includes('--fix');

console.log('📅 EVENT DATE VALIDATOR (Based on WooCommerce Meta Data)\n');
console.log('═══════════════════════════════════════════════\n');
console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN' : FIX ? '🔧 FIX' : '📊 REPORT ONLY'}\n`);

// Get all events
const events = await pool.query(`
  SELECT id, name, event_date, woocommerce_product_id
  FROM tablecn_events
  WHERE woocommerce_product_id IS NOT NULL
  ORDER BY event_date DESC
`);

console.log(`Checking ${events.rows.length} events...\n`);

const results = {
  total: events.rows.length,
  correct: 0,
  incorrect: 0,
  noWcDate: 0,
  errors: 0,
  discrepancies: []
};

let checkedCount = 0;

for (const event of events.rows) {
  checkedCount++;

  if (checkedCount % 20 === 0) {
    console.log(`Progress: ${checkedCount}/${events.rows.length}...`);
  }

  try {
    // Fetch product from WooCommerce
    const response = await woocommerce.get(`products/${event.woocommerce_product_id}`);
    const product = response.data;

    // Find event_date in meta_data
    const eventDateMeta = product.meta_data?.find(m => m.key === 'event_date');

    if (!eventDateMeta || !eventDateMeta.value) {
      results.noWcDate++;
      continue;
    }

    // Parse WooCommerce date (format: YYYYMMDD)
    const wcDateStr = eventDateMeta.value.toString();
    const wcYear = parseInt(wcDateStr.substring(0, 4));
    const wcMonth = parseInt(wcDateStr.substring(4, 6)) - 1; // JS months are 0-indexed
    const wcDay = parseInt(wcDateStr.substring(6, 8));
    const wcDate = new Date(wcYear, wcMonth, wcDay);

    // Parse DB date (already a Date object, but normalize to midnight)
    const dbDate = new Date(event.event_date);
    dbDate.setHours(0, 0, 0, 0);

    // Compare dates
    const daysDiff = Math.round((wcDate - dbDate) / (1000 * 60 * 60 * 24));

    if (daysDiff === 0) {
      results.correct++;
    } else {
      results.incorrect++;
      results.discrepancies.push({
        event_id: event.id,
        event_name: event.name,
        product_id: event.woocommerce_product_id,
        db_date: dbDate.toISOString().split('T')[0],
        wc_date: wcDate.toISOString().split('T')[0],
        wc_date_raw: wcDateStr,
        days_diff: daysDiff,
      });
    }

  } catch (error) {
    results.errors++;
    console.error(`   ✗ Error checking ${event.name}: ${error.message}`);
  }

  // Rate limit
  await new Promise(resolve => setTimeout(resolve, 150));
}

console.log('\n' + '═'.repeat(50));
console.log('\n📊 VALIDATION RESULTS\n');
console.log(`Total events checked: ${results.total}`);
console.log(`✅ Correct dates: ${results.correct}`);
console.log(`❌ Incorrect dates: ${results.incorrect}`);
console.log(`⚠️  No WC date found: ${results.noWcDate}`);
console.log(`🔥 Errors: ${results.errors}\n`);

if (results.discrepancies.length > 0) {
  console.log('━'.repeat(50));
  console.log(`\n❌ FOUND ${results.discrepancies.length} DATE DISCREPANCIES\n`);

  // Save to CSV
  const csv = [
    'event_id,event_name,product_id,database_date,woocommerce_date,wc_raw,days_difference',
    ...results.discrepancies.map(d =>
      `${d.event_id},"${d.event_name.replace(/"/g, '""')}",${d.product_id},${d.db_date},${d.wc_date},${d.wc_date_raw},${d.days_diff}`
    )
  ].join('\n');

  fs.writeFileSync('date-discrepancies.csv', csv);
  console.log('📄 Saved to: date-discrepancies.csv\n');

  // Show first 10
  console.log('First 10 discrepancies:\n');
  results.discrepancies.slice(0, 10).forEach((d, i) => {
    console.log(`${i + 1}. ${d.event_name.substring(0, 60)}`);
    console.log(`   DB date: ${d.db_date}`);
    console.log(`   WC date: ${d.wc_date} (${d.wc_date_raw})`);
    console.log(`   Difference: ${d.days_diff} days\n`);
  });

  if (results.discrepancies.length > 10) {
    console.log(`... and ${results.discrepancies.length - 10} more (see CSV)\n`);
  }
}

// Fix mode
if (FIX && !DRY_RUN && results.discrepancies.length > 0) {
  console.log('━'.repeat(50));
  console.log('\n🔧 FIXING DATES...\n');

  const backup = results.discrepancies.map(d => ({
    event_id: d.event_id,
    old_date: d.db_date,
    new_date: d.wc_date,
  }));

  fs.writeFileSync(
    `date-fix-backup-${new Date().toISOString().replace(/:/g, '-')}.json`,
    JSON.stringify(backup, null, 2)
  );

  let fixed = 0;
  let failed = 0;

  for (const disc of results.discrepancies) {
    try {
      // Parse WC date to set in DB
      const wcDateStr = disc.wc_date_raw;
      const year = parseInt(wcDateStr.substring(0, 4));
      const month = parseInt(wcDateStr.substring(4, 6)) - 1;
      const day = parseInt(wcDateStr.substring(6, 8));
      const newDate = new Date(year, month, day);

      await pool.query(
        'UPDATE tablecn_events SET event_date = $1 WHERE id = $2',
        [newDate, disc.event_id]
      );

      fixed++;
      console.log(`✅ Fixed: ${disc.event_name.substring(0, 50)}`);
    } catch (error) {
      failed++;
      console.error(`❌ Failed: ${disc.event_name.substring(0, 50)} - ${error.message}`);
    }
  }

  console.log(`\n📊 Fix Summary:`);
  console.log(`   Fixed: ${fixed}`);
  console.log(`   Failed: ${failed}`);
}

if (DRY_RUN && results.discrepancies.length > 0) {
  console.log('━'.repeat(50));
  console.log('\n🔍 DRY RUN - No changes made');
  console.log(`\nTo fix these dates, run:`);
  console.log(`   node validate-event-dates.mjs --fix\n`);
}

await pool.end();
