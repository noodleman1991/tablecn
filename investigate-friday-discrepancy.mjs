#!/usr/bin/env node
/**
 * Investigate Friday Night Music Event Discrepancy
 *
 * WooCommerce source of truth: 29 tickets
 * Database shows: 41 tickets
 *
 * Need to find: Which 12 extra tickets are in DB that shouldn't be?
 */

import { createRequire } from 'module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
});

// WooCommerce source of truth ticket IDs
const woocommerceTicketIds = [
  '18228', '18234', '18244', '18246', '18257', '18273', '18280', '18301',
  '18302', '18308', '18329', '18331', '18335', '18340', '18360', '18361',
  '18362', '18372', '18377', '18383', '18384', '18385', '18388', '18392',
  '18394', '18395', '18397', '18399', '18401'
];

console.log('🔍 FRIDAY NIGHT MUSIC EVENT DISCREPANCY INVESTIGATION\n');
console.log('═══════════════════════════════════════════════\n');

console.log(`WooCommerce (source of truth): ${woocommerceTicketIds.length} tickets`);
console.log(`Database claims: 41 tickets\n`);

// Find the event
const eventResult = await pool.query(`
  SELECT id, name, woocommerce_product_id
  FROM tablecn_events
  WHERE name ILIKE '%friday%music%kareem%'
`);

if (eventResult.rows.length === 0) {
  console.error('❌ Event not found in database');
  await pool.end();
  process.exit(1);
}

const event = eventResult.rows[0];
console.log(`Event found: ${event.name}`);
console.log(`Event ID: ${event.id}`);
console.log(`Product ID: ${event.woocommerce_product_id}\n`);

// Get ALL tickets from database for this event
const dbTickets = await pool.query(`
  SELECT
    id,
    ticket_id,
    email,
    first_name,
    last_name,
    woocommerce_order_id,
    created_at,
    checked_in,
    manually_added
  FROM tablecn_attendees
  WHERE event_id = $1
  ORDER BY ticket_id
`, [event.id]);

console.log(`Database tickets: ${dbTickets.rows.length}\n`);

// Categorize tickets
const inWooCommerce = [];
const notInWooCommerce = [];

for (const dbTicket of dbTickets.rows) {
  if (woocommerceTicketIds.includes(dbTicket.ticket_id)) {
    inWooCommerce.push(dbTicket);
  } else {
    notInWooCommerce.push(dbTicket);
  }
}

console.log('📊 ANALYSIS\n');
console.log('─'.repeat(50));
console.log(`✓ Tickets in both WooCommerce & DB: ${inWooCommerce.length}`);
console.log(`❌ Tickets in DB but NOT in WooCommerce: ${notInWooCommerce.length}\n`);

if (notInWooCommerce.length > 0) {
  console.log('❌ EXTRA TICKETS IN DATABASE (should not exist):\n');
  notInWooCommerce.forEach((ticket, i) => {
    console.log(`${i + 1}. Ticket ID: ${ticket.ticket_id}`);
    console.log(`   Name: ${ticket.first_name} ${ticket.last_name}`);
    console.log(`   Email: ${ticket.email}`);
    console.log(`   Order ID: ${ticket.woocommerce_order_id}`);
    console.log(`   Created: ${ticket.created_at}`);
    console.log(`   Manually added: ${ticket.manually_added}`);
    console.log(`   Checked in: ${ticket.checked_in}`);
    console.log(`   Database ID: ${ticket.id}\n`);
  });
}

// Check if any WooCommerce tickets are MISSING from database
const dbTicketIds = new Set(dbTickets.rows.map(t => t.ticket_id));
const missingFromDb = woocommerceTicketIds.filter(tid => !dbTicketIds.has(tid));

if (missingFromDb.length > 0) {
  console.log(`⚠️  MISSING FROM DATABASE (should exist):\n`);
  missingFromDb.forEach(tid => {
    console.log(`  - Ticket ID: ${tid}`);
  });
  console.log('');
}

// Check for duplicates
console.log('🔍 DUPLICATE CHECK\n');
console.log('─'.repeat(50));

const duplicateCheck = await pool.query(`
  SELECT
    ticket_id,
    COUNT(*) as count,
    array_agg(id) as db_ids,
    array_agg(email) as emails
  FROM tablecn_attendees
  WHERE event_id = $1
  GROUP BY ticket_id
  HAVING COUNT(*) > 1
`, [event.id]);

if (duplicateCheck.rows.length > 0) {
  console.log(`❌ Found ${duplicateCheck.rows.length} duplicate ticket IDs:\n`);
  duplicateCheck.rows.forEach(dup => {
    console.log(`  Ticket ID: ${dup.ticket_id}`);
    console.log(`  Appears: ${dup.count} times`);
    console.log(`  DB IDs: ${dup.db_ids.join(', ')}`);
    console.log(`  Emails: ${dup.emails.join(', ')}\n`);
  });
} else {
  console.log('✅ No duplicates found\n');
}

console.log('\n═══════════════════════════════════════════════');
console.log('🎯 ROOT CAUSE DETERMINATION\n');

if (notInWooCommerce.length > 0) {
  console.log('❌ DATABASE CONTAINS INVALID TICKETS');
  console.log(`   ${notInWooCommerce.length} tickets exist in database but NOT in WooCommerce`);
  console.log('   These are likely from:');
  console.log('   - A previous sync that pulled wrong data');
  console.log('   - Manual additions that should not have happened');
  console.log('   - Tickets from a DIFFERENT event accidentally added here\n');

  console.log('💡 RECOMMENDED ACTION:');
  console.log('   DELETE these extra tickets from database to match WooCommerce\n');

  console.log('   SQL to fix:');
  const idsToDelete = notInWooCommerce.map(t => `'${t.id}'`).join(', ');
  console.log(`   DELETE FROM tablecn_attendees WHERE id IN (${idsToDelete});\n`);
}

if (missingFromDb.length > 0) {
  console.log('⚠️  DATABASE MISSING VALID TICKETS');
  console.log(`   ${missingFromDb.length} tickets exist in WooCommerce but NOT in database`);
  console.log('   These need to be synced from WooCommerce\n');
}

await pool.end();
