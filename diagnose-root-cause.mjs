// Root Cause Diagnostic Script
// Runs 6 critical queries to understand sync failures

import { createRequire } from 'module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
});

async function runDiagnostics() {
  console.log('🔍 STARTING ROOT CAUSE DIAGNOSTICS\n');
  console.log('========================================\n');

  // Query 1: Find Event 141's database record
  console.log('📋 Query 1: Event 141 Database Record');
  console.log('─'.repeat(50));
  const event141 = await pool.query(`
    SELECT
      id,
      name,
      event_date,
      woocommerce_product_id,
      created_at
    FROM tablecn_events
    WHERE woocommerce_product_id = '9879'
       OR name ILIKE '%Keeping the World Intact%'
  `);
  console.log('Results:', event141.rows);
  console.log('\n');

  // Query 2: Do the 47 ticket IDs exist ANYWHERE?
  console.log('📋 Query 2: Do Event 141 Tickets Exist in DB?');
  console.log('─'.repeat(50));
  const ticketIds = [
    '10037', '10051', '10065', '10094', '10117', '10120', '10128', '10193',
    '10230', '10313', '10329', '10344', '10345', '10349', '10357', '10369',
    '10371', '10373', '10384', '10399', '10400', '10414', '10426', '10428',
    '10430', '10432', '10434', '10461', '10480', '10490', '10491', '10500',
    '10526', '10529', '10531', '10533', '10536', '10538', '10550', '10551',
    '10583', '10585', '10586', '10587'
  ];

  const existingTickets = await pool.query(`
    SELECT
      ticket_id,
      event_id,
      email,
      substring(woocommerce_order_id, 1, 10) as order_id,
      created_at
    FROM tablecn_attendees
    WHERE ticket_id = ANY($1)
    ORDER BY event_id, ticket_id
  `, [ticketIds]);

  console.log(`Found ${existingTickets.rows.length} out of ${ticketIds.length} tickets`);
  if (existingTickets.rows.length > 0) {
    console.log('Sample (first 5):');
    existingTickets.rows.slice(0, 5).forEach(row => {
      console.log(`  - Ticket ${row.ticket_id}: event_id=${row.event_id}, email=${row.email}`);
    });

    // Check if they're all in the same event
    const uniqueEventIds = new Set(existingTickets.rows.map(r => r.event_id));
    console.log(`\nUnique event_ids found: ${Array.from(uniqueEventIds).join(', ')}`);
  } else {
    console.log('❌ ZERO TICKETS FOUND - Tickets were never inserted!');
  }
  console.log('\n');

  // Query 3: Check event ordering
  console.log('📋 Query 3: Event Ordering Check');
  console.log('─'.repeat(50));
  const eventsWithProducts = await pool.query(`
    SELECT id, name, event_date, woocommerce_product_id
    FROM tablecn_events
    WHERE woocommerce_product_id IS NOT NULL
    ORDER BY event_date ASC
  `);
  console.log(`Total events with products: ${eventsWithProducts.rows.length}`);

  // Find Event 141 in the ordered list
  const event141Index = eventsWithProducts.rows.findIndex(
    e => e.woocommerce_product_id === '9879'
  );
  console.log(`Event with product 9879 is at position: ${event141Index + 1} (1-indexed)`);

  if (event141Index >= 0) {
    const event = eventsWithProducts.rows[event141Index];
    console.log(`Event at position ${event141Index + 1}:`, {
      id: event.id,
      name: event.name.substring(0, 40),
      product: event.woocommerce_product_id
    });
  }

  // Show events around position 141
  console.log(`\nEvents around position 141:`);
  for (let i = 138; i < 144 && i < eventsWithProducts.rows.length; i++) {
    const e = eventsWithProducts.rows[i];
    console.log(`  ${i + 1}. ${e.name.substring(0, 40)} (product: ${e.woocommerce_product_id})`);
  }
  console.log('\n');

  // Query 4: System-wide validation
  console.log('📋 Query 4: System-Wide Ticket Counts');
  console.log('─'.repeat(50));
  const systemWide = await pool.query(`
    SELECT
      e.id,
      substring(e.name, 1, 50) as name,
      e.woocommerce_product_id,
      COUNT(a.id) as ticket_count
    FROM tablecn_events e
    LEFT JOIN tablecn_attendees a ON a.event_id = e.id
    WHERE e.woocommerce_product_id IS NOT NULL
    GROUP BY e.id, e.name, e.woocommerce_product_id
    ORDER BY e.event_date DESC
    LIMIT 30
  `);

  const zeroTicketEvents = systemWide.rows.filter(r => r.ticket_count === '0');
  console.log(`Events with 0 tickets: ${zeroTicketEvents.length} out of ${systemWide.rows.length}`);
  console.log('\nFirst 10 events with 0 tickets:');
  zeroTicketEvents.slice(0, 10).forEach(e => {
    console.log(`  - ${e.name} (product: ${e.woocommerce_product_id})`);
  });
  console.log('\n');

  // Query 5: Check for duplicates
  console.log('📋 Query 5a: Duplicate Tickets (Same Event)');
  console.log('─'.repeat(50));
  const duplicates = await pool.query(`
    SELECT
      event_id,
      ticket_id,
      COUNT(*) as count
    FROM tablecn_attendees
    WHERE ticket_id IS NOT NULL AND ticket_id != ''
    GROUP BY event_id, ticket_id
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT 10
  `);
  console.log(`Found ${duplicates.rows.length} duplicate ticket_ids within same events`);
  if (duplicates.rows.length > 0) {
    console.log('Sample duplicates:');
    duplicates.rows.forEach(d => {
      console.log(`  - Ticket ${d.ticket_id} in event ${d.event_id}: ${d.count} copies`);
    });
  }
  console.log('\n');

  console.log('📋 Query 5b: Tickets in Multiple Events');
  console.log('─'.repeat(50));
  const crossEventDuplicates = await pool.query(`
    SELECT
      ticket_id,
      COUNT(DISTINCT event_id) as event_count,
      array_agg(DISTINCT event_id) as event_ids
    FROM tablecn_attendees
    WHERE ticket_id IS NOT NULL AND ticket_id != ''
    GROUP BY ticket_id
    HAVING COUNT(DISTINCT event_id) > 1
    ORDER BY event_count DESC
    LIMIT 10
  `);
  console.log(`Found ${crossEventDuplicates.rows.length} tickets appearing in multiple events`);
  if (crossEventDuplicates.rows.length > 0) {
    console.log('Sample cross-event duplicates:');
    crossEventDuplicates.rows.forEach(d => {
      console.log(`  - Ticket ${d.ticket_id}: in ${d.event_count} events (${d.event_ids.join(', ')})`);
    });
  }
  console.log('\n');

  // Query 6: Date accuracy
  console.log('📋 Query 6: Event Date Accuracy');
  console.log('─'.repeat(50));
  const dateIssues = await pool.query(`
    SELECT
      e.id,
      substring(e.name, 1, 40) as name,
      e.event_date,
      MIN(a.woocommerce_order_date) as first_order,
      MAX(a.woocommerce_order_date) as last_order
    FROM tablecn_events e
    JOIN tablecn_attendees a ON a.event_id = e.id
    WHERE a.woocommerce_order_date IS NOT NULL
    GROUP BY e.id, e.name, e.event_date
    HAVING AGE(e.event_date, MIN(a.woocommerce_order_date::date)) < interval '0 days'
       OR AGE(e.event_date, MIN(a.woocommerce_order_date::date)) > interval '2 years'
    ORDER BY first_order DESC
    LIMIT 10
  `);
  console.log(`Found ${dateIssues.rows.length} events with suspicious date gaps`);
  if (dateIssues.rows.length > 0) {
    console.log('Sample date issues:');
    dateIssues.rows.forEach(e => {
      console.log(`  - ${e.name}`);
      console.log(`    Event date: ${e.event_date}`);
      console.log(`    First order: ${e.first_order}`);
    });
  }
  console.log('\n');

  console.log('========================================');
  console.log('🎯 ROOT CAUSE ANALYSIS\n');

  // Determine root cause
  if (existingTickets.rows.length === 0) {
    console.log('❌ SCENARIO B: Tickets DO NOT exist in database');
    console.log('   - Script claims tickets exist');
    console.log('   - But database has zero tickets');
    console.log('   - Root cause: Duplicate check logic is broken');
    console.log('   - OR: Transaction rollback happening');
  } else if (existingTickets.rows.length === ticketIds.length) {
    const uniqueEventIds = new Set(existingTickets.rows.map(r => r.event_id));
    if (uniqueEventIds.size === 1) {
      const foundEventId = Array.from(uniqueEventIds)[0];
      const expectedEventId = event141.rows[0]?.id;
      if (foundEventId !== expectedEventId) {
        console.log('⚠️  SCENARIO A: Event ID Mismatch');
        console.log(`   - All 47 tickets exist in database`);
        console.log(`   - But they're under event_id: ${foundEventId}`);
        console.log(`   - Expected event_id: ${expectedEventId}`);
        console.log(`   - Root cause: Event indexing is wrong`);
      } else {
        console.log('✅ Tickets exist with correct event_id');
        console.log('   - This might be a UI display issue');
      }
    } else {
      console.log('⚠️  SCENARIO A: Tickets scattered across multiple events');
      console.log(`   - Found in ${uniqueEventIds.size} different events: ${Array.from(uniqueEventIds).join(', ')}`);
      console.log('   - Root cause: Product ID collision or wrong event assignment');
    }
  } else {
    console.log('🔍 PARTIAL DATA: Some tickets exist, some do not');
    console.log(`   - Found ${existingTickets.rows.length} out of ${ticketIds.length}`);
    console.log('   - Root cause: Partial sync or transaction failure');
  }

  await pool.end();
}

runDiagnostics().catch(console.error);
