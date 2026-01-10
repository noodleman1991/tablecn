#!/usr/bin/env node
/**
 * FIX EVENT DATES
 *
 * Problem: 159 events have ALL tickets purchased AFTER the event date
 * This means the event_date field is wrong, not the tickets
 *
 * Solution:
 * 1. Find events where 100% of tickets were purchased after event date
 * 2. Propose new date = earliest purchase date
 * 3. Interactive approval OR auto-fix mode
 * 4. Update event dates
 * 5. Backup old dates
 */

import { createRequire } from 'module';
import pg from 'pg';
import fs from 'fs';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
});

const AUTO_FIX = process.argv.includes('--auto');
const DRY_RUN = process.argv.includes('--dry-run');

console.log('📅 EVENT DATE FIXER\n');
console.log('═══════════════════════════════════════════════\n');
console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN' : AUTO_FIX ? '🤖 AUTO-FIX' : '👤 INTERACTIVE'}\n`);

// Find events with date issues
console.log('Finding events with date issues...\n');

const problematicEvents = await pool.query(`
  SELECT
    e.id,
    e.name,
    e.event_date,
    MIN(a.woocommerce_order_date) as first_purchase,
    MAX(a.woocommerce_order_date) as last_purchase,
    COUNT(a.id) as ticket_count,
    COUNT(a.id) FILTER (WHERE a.woocommerce_order_date > e.event_date) as tickets_after
  FROM tablecn_events e
  JOIN tablecn_attendees a ON a.event_id = e.id
  WHERE a.woocommerce_order_date IS NOT NULL
  GROUP BY e.id, e.name, e.event_date
  HAVING COUNT(a.id) > 0
    AND COUNT(a.id) FILTER (WHERE a.woocommerce_order_date > e.event_date) = COUNT(a.id)
  ORDER BY e.event_date DESC
`);

console.log(`Found ${problematicEvents.rows.length} events where ALL tickets purchased after event date\n`);

if (problematicEvents.rows.length === 0) {
  console.log('✅ No date issues found!');
  await pool.end();
  process.exit(0);
}

// Show first 10 as examples
console.log('Examples (first 10):\n');
problematicEvents.rows.slice(0, 10).forEach((e, i) => {
  console.log(`${i + 1}. ${e.name.substring(0, 50)}`);
  console.log(`   Current date: ${e.event_date}`);
  console.log(`   First purchase: ${e.first_purchase}`);
  console.log(`   Suggested fix: ${e.first_purchase}`);
  console.log('');
});

// Backup
const backupFile = `event-dates-backup-${new Date().toISOString().replace(/:/g, '-')}.json`;
const backupData = problematicEvents.rows.map(e => ({
  event_id: e.id,
  event_name: e.name,
  old_date: e.event_date,
  new_date: e.first_purchase,
  ticket_count: e.ticket_count
}));

if (!DRY_RUN) {
  fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
  console.log(`📦 Backup saved: ${backupFile}\n`);
}

if (DRY_RUN) {
  console.log('🔍 DRY RUN: Would fix all these events');
  console.log(`   Total: ${problematicEvents.rows.length} events`);
  await pool.end();
  process.exit(0);
}

// Fix events
let fixedCount = 0;
let skippedCount = 0;

console.log(`\n${'='.repeat(50)}`);
console.log('Starting fixes...\n');

for (const event of problematicEvents.rows) {
  const oldDate = new Date(event.event_date);
  const newDate = new Date(event.first_purchase);
  const daysDiff = Math.round((newDate - oldDate) / (1000 * 60 * 60 * 24));

  console.log(`\n📅 Event: ${event.name.substring(0, 60)}`);
  console.log(`   Old date: ${oldDate.toDateString()}`);
  console.log(`   New date: ${newDate.toDateString()}`);
  console.log(`   Difference: ${daysDiff} days later`);
  console.log(`   Tickets: ${event.ticket_count}`);

  if (!AUTO_FIX) {
    // Interactive mode - would need readline, skip for now
    console.log(`   ⚠️  Interactive mode not implemented - use --auto flag`);
    skippedCount++;
    continue;
  }

  // Auto-fix mode
  try {
    await pool.query(
      `UPDATE tablecn_events SET event_date = $1 WHERE id = $2`,
      [event.first_purchase, event.id]
    );
    console.log(`   ✅ Fixed`);
    fixedCount++;
  } catch (error) {
    console.error(`   ❌ Failed: ${error.message}`);
    skippedCount++;
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log('\n📊 SUMMARY\n');
console.log(`   Fixed: ${fixedCount}`);
console.log(`   Skipped: ${skippedCount}`);
console.log(`   Total: ${problematicEvents.rows.length}`);

if (fixedCount > 0) {
  console.log(`\n✅ Event dates fixed!`);
  console.log(`📦 Backup available in: ${backupFile}`);
}

await pool.end();
