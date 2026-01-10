#!/usr/bin/env node
/**
 * REAL Data Investigation Script
 *
 * Purpose: Actually check the data instead of trusting audit queries
 * - Check Friday night music event for duplicates
 * - Find Event 141's actual tickets
 * - List ALL duplicate tickets in system
 * - Check empty events from 2024
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

console.log('🔍 REAL DATA INVESTIGATION\n');
console.log('═══════════════════════════════════════════════\n');

// Query 1: Check the Friday night music event
console.log('📋 Query 1: Friday Night Music with Kareem Samara');
console.log('─'.repeat(50));

const fridayEvent = await pool.query(`
  SELECT
    e.id as event_id,
    e.name,
    e.woocommerce_product_id,
    COUNT(a.id) as total_attendees,
    COUNT(DISTINCT a.ticket_id) as unique_tickets,
    COUNT(a.id) - COUNT(DISTINCT a.ticket_id) as duplicates
  FROM tablecn_events e
  LEFT JOIN tablecn_attendees a ON a.event_id = e.id
  WHERE e.name ILIKE '%friday%music%kareem%'
  GROUP BY e.id, e.name, e.woocommerce_product_id
`);

console.log('Results:', JSON.stringify(fridayEvent.rows, null, 2));

if (fridayEvent.rows.length > 0 && parseInt(fridayEvent.rows[0].duplicates) > 0) {
  console.log('\n❌ DUPLICATES FOUND! Getting details...\n');

  const duplicateDetails = await pool.query(`
    SELECT
      ticket_id,
      COUNT(*) as count,
      array_agg(id) as attendee_ids,
      array_agg(email) as emails,
      array_agg(first_name || ' ' || last_name) as names
    FROM tablecn_attendees
    WHERE event_id = $1
      AND ticket_id IS NOT NULL
    GROUP BY ticket_id
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `, [fridayEvent.rows[0].event_id]);

  console.log('Duplicate tickets in this event:');
  duplicateDetails.rows.forEach(d => {
    console.log(`\n  Ticket ID: ${d.ticket_id}`);
    console.log(`  Appears: ${d.count} times`);
    console.log(`  Attendee IDs: ${d.attendee_ids.join(', ')}`);
    console.log(`  Emails: ${d.emails.join(', ')}`);
    console.log(`  Names: ${d.names.join(', ')}`);
  });
}

console.log('\n\n');

// Query 2: Event 141 - where are those 47 tickets?
console.log('📋 Query 2: Event 141 (Product 9879) - Where are the tickets?');
console.log('─'.repeat(50));

const event141 = await pool.query(`
  SELECT
    e.id as event_id,
    e.name,
    e.woocommerce_product_id,
    e.event_date,
    COUNT(a.id) as ticket_count
  FROM tablecn_events e
  LEFT JOIN tablecn_attendees a ON a.event_id = e.id
  WHERE e.woocommerce_product_id = '9879'
  GROUP BY e.id, e.name, e.woocommerce_product_id, e.event_date
`);

console.log('Event 141 info:', JSON.stringify(event141.rows, null, 2));

if (event141.rows.length > 0) {
  const eventId = event141.rows[0].event_id;

  // Get sample tickets
  const tickets = await pool.query(`
    SELECT ticket_id, email, first_name, last_name, created_at
    FROM tablecn_attendees
    WHERE event_id = $1
    LIMIT 10
  `, [eventId]);

  console.log(`\nSample tickets (showing ${tickets.rows.length} of ${event141.rows[0].ticket_count}):`);
  tickets.rows.forEach(t => {
    console.log(`  - ${t.ticket_id}: ${t.email} (${t.first_name} ${t.last_name})`);
  });
}

console.log('\n\n');

// Query 3: System-wide duplicate check
console.log('📋 Query 3: ALL Duplicate Tickets System-Wide');
console.log('─'.repeat(50));

const allDuplicates = await pool.query(`
  SELECT
    ticket_id,
    COUNT(*) as occurrence_count,
    COUNT(DISTINCT event_id) as event_count,
    array_agg(DISTINCT event_id) as event_ids,
    array_agg(email) as emails
  FROM tablecn_attendees
  WHERE ticket_id IS NOT NULL AND ticket_id != ''
  GROUP BY ticket_id
  HAVING COUNT(*) > 1
  ORDER BY COUNT(*) DESC
  LIMIT 20
`);

console.log(`Found ${allDuplicates.rows.length} duplicate ticket_ids in system\n`);

if (allDuplicates.rows.length > 0) {
  console.log('Top duplicates:');
  allDuplicates.rows.forEach((d, i) => {
    console.log(`\n${i + 1}. Ticket ID: ${d.ticket_id}`);
    console.log(`   Occurrences: ${d.occurrence_count}`);
    console.log(`   Events: ${d.event_count} (${d.event_ids.join(', ')})`);
    console.log(`   Emails: ${d.emails.slice(0, 3).join(', ')}...`);
  });
} else {
  console.log('✅ No duplicates found system-wide');
}

console.log('\n\n');

// Query 4: Empty events from 2024
console.log('📋 Query 4: Empty Events from 2024');
console.log('─'.repeat(50));

const empty2024 = await pool.query(`
  SELECT
    e.id,
    e.name,
    e.event_date,
    e.woocommerce_product_id,
    COUNT(a.id) as ticket_count
  FROM tablecn_events e
  LEFT JOIN tablecn_attendees a ON a.event_id = e.id
  WHERE e.woocommerce_product_id IS NOT NULL
    AND e.event_date >= '2024-01-01'
    AND e.event_date < '2025-01-01'
  GROUP BY e.id, e.name, e.event_date, e.woocommerce_product_id
  HAVING COUNT(a.id) = 0
  ORDER BY e.event_date DESC
`);

console.log(`Found ${empty2024.rows.length} empty events from 2024\n`);

if (empty2024.rows.length > 0) {
  console.log('Empty 2024 events (first 10):');
  empty2024.rows.slice(0, 10).forEach(e => {
    console.log(`\n  ${e.name.substring(0, 60)}`);
    console.log(`    Date: ${e.event_date}`);
    console.log(`    Product: ${e.woocommerce_product_id}`);
    console.log(`    Event ID: ${e.id}`);
  });
}

console.log('\n\n');

// Query 5: Check UI display query
console.log('📋 Query 5: How does the UI query events?');
console.log('─'.repeat(50));
console.log('Checking what the members list query returns...\n');

const uiQuery = await pool.query(`
  SELECT
    e.id,
    e.name,
    e.event_date,
    COUNT(a.id) as attendee_count
  FROM tablecn_events e
  LEFT JOIN tablecn_attendees a ON a.event_id = e.id
  WHERE e.woocommerce_product_id = '9879'
  GROUP BY e.id, e.name, e.event_date
`);

console.log('UI would show:', JSON.stringify(uiQuery.rows, null, 2));

console.log('\n\n═══════════════════════════════════════════════');
console.log('🎯 INVESTIGATION COMPLETE');
console.log('═══════════════════════════════════════════════\n');

await pool.end();
