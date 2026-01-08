#!/usr/bin/env node
/**
 * Identify Duplicate Events
 *
 * Finds events that are true duplicates (same name AND date) with one having
 * a WooCommerce ID and one not. This excludes recurring events like "Friday Drinks"
 * which happen on different dates.
 */

import { createRequire } from 'module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const { Client } = pg;

async function findDuplicates() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log('🔍 Finding Duplicate Events (same name AND date)\n');
  console.log('=' .repeat(80));

  // Find events with same name AND date but one has WC ID and one doesn't
  // This excludes recurring events (same name, different dates)
  const result = await client.query(`
    WITH event_groups AS (
      SELECT
        LOWER(TRIM(name)) as normalized_name,
        DATE(event_date) as event_date_only,
        COUNT(*) as event_count,
        COUNT(*) FILTER (WHERE woocommerce_product_id IS NOT NULL) as with_wc_id,
        COUNT(*) FILTER (WHERE woocommerce_product_id IS NULL) as without_wc_id,
        ARRAY_AGG(id ORDER BY created_at) as event_ids,
        ARRAY_AGG(name) as event_names,
        ARRAY_AGG(woocommerce_product_id) as wc_ids,
        ARRAY_AGG(created_at ORDER BY created_at) as created_dates
      FROM tablecn_events
      GROUP BY LOWER(TRIM(name)), DATE(event_date)
      HAVING COUNT(*) > 1
    )
    SELECT * FROM event_groups
    WHERE with_wc_id > 0 AND without_wc_id > 0
    ORDER BY event_count DESC, normalized_name
  `);

  if (result.rows.length === 0) {
    console.log('✅ No duplicate events found!');
    console.log('\nNote: Recurring events (same name, different dates) are NOT considered duplicates.');
    await client.end();
    return;
  }

  console.log(`Found ${result.rows.length} true duplicate events:\n`);

  let totalOrphansToDelete = 0;
  let totalOrphansWithAttendees = 0;

  for (const row of result.rows) {
    console.log(`Event: "${row.normalized_name}"`);
    console.log(`  Date: ${row.event_date_only}`);
    console.log(`  Total instances: ${row.event_count}`);
    console.log(`  With WC ID: ${row.with_wc_id}`);
    console.log(`  Without WC ID: ${row.without_wc_id}`);
    console.log(`  Event IDs: ${row.event_ids.join(', ')}`);
    console.log(`  WC IDs: ${row.wc_ids.filter(id => id).join(', ')}`);

    // Show when each was created
    console.log(`  Created at:`);
    for (let i = 0; i < row.event_ids.length; i++) {
      const hasWcId = row.wc_ids[i] ? '✓' : '✗';
      console.log(`    ${hasWcId} ${row.event_ids[i]}: ${new Date(row.created_dates[i]).toISOString()}`);
    }

    // Check if orphaned events have any attendees
    const orphanIds = await client.query(`
      SELECT e.id, e.name, COUNT(a.id) as attendee_count
      FROM tablecn_events e
      LEFT JOIN tablecn_attendees a ON a.event_id = e.id
      WHERE e.id = ANY($1) AND e.woocommerce_product_id IS NULL
      GROUP BY e.id, e.name
    `, [row.event_ids]);

    for (const orphan of orphanIds.rows) {
      if (orphan.attendee_count > 0) {
        console.log(`  ⚠️  WARNING: Orphan event ${orphan.id} has ${orphan.attendee_count} attendees!`);
        console.log(`      These attendees should be MERGED to the proper event before deletion.`);
        totalOrphansWithAttendees++;
      } else {
        console.log(`  ✓ Safe to delete: Orphan event ${orphan.id} has 0 attendees`);
        totalOrphansToDelete++;
      }
    }
    console.log();
  }

  console.log('=' .repeat(80));
  console.log('\n📊 Summary:');
  console.log(`  Total duplicate groups: ${result.rows.length}`);
  console.log(`  Orphans safe to delete: ${totalOrphansToDelete}`);
  console.log(`  Orphans needing merge: ${totalOrphansWithAttendees}`);

  console.log('\n💡 Recommended Actions:');
  console.log('  1. Safe orphans: DELETE FROM tablecn_events WHERE id IN (...)');
  console.log('  2. Orphans with attendees: Manually merge attendees first');
  console.log('\n⚠️  Important: Recurring events (same name, different dates) are NOT flagged as duplicates.');
  console.log('     Examples: "Friday Drinks", "Sunday Reading Room", "Open Projects Night"');

  await client.end();
}

findDuplicates().catch(console.error);
