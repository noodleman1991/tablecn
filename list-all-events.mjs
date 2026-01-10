#!/usr/bin/env node
/**
 * List all events with their IDs and product IDs
 * Use this to choose which event to sync
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

console.log('📋 ALL EVENTS LIST\n');
console.log('═══════════════════════════════════════════════\n');

const events = await pool.query(`
  SELECT
    e.id,
    e.name,
    e.event_date,
    e.woocommerce_product_id,
    COUNT(a.id) as ticket_count
  FROM tablecn_events e
  LEFT JOIN tablecn_attendees a ON a.event_id = e.id
  WHERE e.woocommerce_product_id IS NOT NULL
  GROUP BY e.id, e.name, e.event_date, e.woocommerce_product_id
  ORDER BY e.event_date DESC
`);

console.log(`Total: ${events.rows.length} events\n`);

// Export to CSV
const fs = require('fs');
const csv = [
  'event_id,event_name,event_date,product_id,current_ticket_count',
  ...events.rows.map(e =>
    `${e.id},"${e.name.replace(/"/g, '""')}",${e.event_date},${e.woocommerce_product_id},${e.ticket_count}`
  )
].join('\n');

fs.writeFileSync('all-events-list.csv', csv);
console.log('✅ Saved to: all-events-list.csv\n');

// Show first 20
console.log('First 20 events:\n');
events.rows.slice(0, 20).forEach((e, i) => {
  console.log(`${i + 1}. ${e.name.substring(0, 60)}`);
  console.log(`   Event ID: ${e.id}`);
  console.log(`   Product: ${e.woocommerce_product_id}`);
  console.log(`   Date: ${e.event_date}`);
  console.log(`   Current tickets: ${e.ticket_count}\n`);
});

console.log(`\n... and ${events.rows.length - 20} more events`);
console.log('\n📄 Full list in: all-events-list.csv');

await pool.end();
