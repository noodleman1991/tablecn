// Verify Resync Results Script
// Validates the comprehensive resync and member rebuild
// Checks data integrity and provides statistics

import { createRequire } from 'module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const { Client } = pg;

/**
 * Main verification function
 */
async function verifyResync() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();
  console.log('🔌 Connected to database\n');

  try {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 RESYNC VERIFICATION REPORT');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // 1. Total events synced
    console.log('📅 Events:');
    const eventsResult = await client.query(`
      SELECT COUNT(*) as total
      FROM tablecn_events
      WHERE woocommerce_product_id IS NOT NULL
    `);
    console.log(`   Total events with WooCommerce IDs: ${eventsResult.rows[0].total}`);

    // 2. Total attendees created
    console.log('\n👥 Attendees:');
    const attendeesResult = await client.query(`
      SELECT COUNT(*) as total
      FROM tablecn_attendees
    `);
    console.log(`   Total attendees: ${attendeesResult.rows[0].total}`);

    // 3. Attendees per event statistics
    const attendeesPerEventResult = await client.query(`
      SELECT
        COUNT(DISTINCT event_id) as events_with_attendees,
        AVG(attendee_count) as avg_per_event,
        MAX(attendee_count) as max_per_event,
        MIN(attendee_count) as min_per_event
      FROM (
        SELECT event_id, COUNT(*) as attendee_count
        FROM tablecn_attendees
        GROUP BY event_id
      ) as event_counts
    `);
    const attendeeStats = attendeesPerEventResult.rows[0];
    console.log(`   Events with attendees: ${attendeeStats.events_with_attendees}`);
    console.log(`   Average per event: ${parseFloat(attendeeStats.avg_per_event).toFixed(1)}`);
    console.log(`   Max per event: ${attendeeStats.max_per_event}`);
    console.log(`   Min per event: ${attendeeStats.min_per_event}`);

    // 4. Past events check-in rate (should be 100%)
    console.log('\n✅ Past Events Check-in (before Jan 5, 2026):');
    const pastCheckInResult = await client.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN checked_in THEN 1 ELSE 0 END) as checked_in
      FROM tablecn_attendees a
      JOIN tablecn_events e ON a.event_id = e.id
      WHERE e.event_date < '2026-01-05T23:59:59Z'
    `);
    const pastStats = pastCheckInResult.rows[0];
    const pastCheckInRate = pastStats.total > 0
      ? ((pastStats.checked_in / pastStats.total) * 100).toFixed(1)
      : '0.0';
    console.log(`   Total past attendees: ${pastStats.total}`);
    console.log(`   Checked in: ${pastStats.checked_in}`);
    console.log(`   Check-in rate: ${pastCheckInRate}% (should be 100%)`);
    if (pastCheckInRate !== '100.0') {
      console.log('   ⚠️  WARNING: Not all past attendees are marked as checked in!');
    }

    // 5. Future events check-in rate (should be 0%)
    console.log('\n📅 Future Events Check-in (Jan 5, 2026+):');
    const futureCheckInResult = await client.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN checked_in THEN 1 ELSE 0 END) as checked_in
      FROM tablecn_attendees a
      JOIN tablecn_events e ON a.event_id = e.id
      WHERE e.event_date >= '2026-01-05T23:59:59Z'
    `);
    const futureStats = futureCheckInResult.rows[0];
    const futureCheckInRate = futureStats.total > 0
      ? ((futureStats.checked_in / futureStats.total) * 100).toFixed(1)
      : '0.0';
    console.log(`   Total future attendees: ${futureStats.total}`);
    console.log(`   Checked in: ${futureStats.checked_in}`);
    console.log(`   Check-in rate: ${futureCheckInRate}% (should be 0%)`);
    if (futureCheckInRate !== '0.0') {
      console.log('   ⚠️  WARNING: Some future attendees are marked as checked in!');
    }

    // 6. Community members
    console.log('\n🏘️  Community Members:');
    const membersResult = await client.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN is_active_member THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN NOT is_active_member THEN 1 ELSE 0 END) as inactive
      FROM tablecn_members
    `);
    const memberStats = membersResult.rows[0];
    console.log(`   Total members: ${memberStats.total}`);
    console.log(`   Active members: ${memberStats.active}`);
    console.log(`   Inactive members: ${memberStats.inactive}`);

    // 7. Active member attendance distribution
    const activeDistributionResult = await client.query(`
      SELECT
        total_events_attended,
        COUNT(*) as member_count
      FROM tablecn_members
      WHERE is_active_member = true
      GROUP BY total_events_attended
      ORDER BY total_events_attended DESC
      LIMIT 10
    `);
    console.log('\n   Active member attendance distribution (top 10):');
    activeDistributionResult.rows.forEach(row => {
      console.log(`     ${row.total_events_attended} events: ${row.member_count} members`);
    });

    // 7.5. Check for duplicate tickets (should be 0 after cleanup and constraint)
    console.log('\n🔍 Duplicate Ticket Check:');
    const duplicateCheck = await client.query(`
      SELECT ticket_id, event_id, COUNT(*) as count
      FROM tablecn_attendees
      WHERE ticket_id IS NOT NULL
      GROUP BY ticket_id, event_id
      HAVING COUNT(*) > 1
    `);

    if (duplicateCheck.rows.length > 0) {
      console.log(`   ⚠️  WARNING: Found ${duplicateCheck.rows.length} duplicate ticket groups!`);
      duplicateCheck.rows.slice(0, 5).forEach((row, index) => {
        console.log(`   ${index + 1}. Ticket ${row.ticket_id}: ${row.count} duplicates`);
      });
      if (duplicateCheck.rows.length > 5) {
        console.log(`   ... and ${duplicateCheck.rows.length - 5} more`);
      }
    } else {
      console.log('   ✓ No duplicate tickets found!');
    }

    // 8. Multi-ticket order verification
    console.log('\n🎫 Multi-Ticket Orders (different names):');
    const multiTicketResult = await client.query(`
      SELECT
        woocommerce_order_id,
        COUNT(*) as ticket_count,
        array_agg(DISTINCT first_name || ' ' || last_name) as names,
        array_agg(DISTINCT email) as emails
      FROM tablecn_attendees
      WHERE woocommerce_order_id IS NOT NULL
      GROUP BY woocommerce_order_id
      HAVING COUNT(*) > 1
      ORDER BY ticket_count DESC
      LIMIT 10
    `);
    console.log(`   Total multi-ticket orders: ${multiTicketResult.rows.length}`);
    console.log('\n   Sample multi-ticket orders:');
    multiTicketResult.rows.forEach((row, index) => {
      console.log(`   ${index + 1}. Order ${row.woocommerce_order_id}:`);
      console.log(`      Tickets: ${row.ticket_count}`);
      console.log(`      Names: ${row.names.join(', ')}`);
      console.log(`      Emails: ${row.emails.join(', ')}`);
    });

    // 9. Booker vs Ticket Holder verification
    console.log('\n📋 Booker vs Ticket Holder Separation:');
    const separationResult = await client.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN email != booker_email THEN 1 ELSE 0 END) as different_emails,
        SUM(CASE WHEN first_name != booker_first_name OR last_name != booker_last_name THEN 1 ELSE 0 END) as different_names
      FROM tablecn_attendees
      WHERE booker_email IS NOT NULL AND booker_email != ''
    `);
    const separationStats = separationResult.rows[0];
    const diffEmailPct = separationStats.total > 0
      ? ((separationStats.different_emails / separationStats.total) * 100).toFixed(1)
      : '0.0';
    const diffNamePct = separationStats.total > 0
      ? ((separationStats.different_names / separationStats.total) * 100).toFixed(1)
      : '0.0';
    console.log(`   Total attendees with booker info: ${separationStats.total}`);
    console.log(`   Different email (ticket ≠ booker): ${separationStats.different_emails} (${diffEmailPct}%)`);
    console.log(`   Different name (ticket ≠ booker): ${separationStats.different_names} (${diffNamePct}%)`);

    // 10. Events without attendees (potential issues)
    console.log('\n⚠️  Events Without Attendees:');
    const eventsWithoutAttendeesResult = await client.query(`
      SELECT e.id, e.name, e.event_date
      FROM tablecn_events e
      WHERE e.woocommerce_product_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM tablecn_attendees a WHERE a.event_id = e.id
        )
      ORDER BY e.event_date DESC
      LIMIT 10
    `);
    if (eventsWithoutAttendeesResult.rows.length > 0) {
      console.log(`   Found ${eventsWithoutAttendeesResult.rows.length} events without attendees:`);
      eventsWithoutAttendeesResult.rows.forEach((event, index) => {
        console.log(`   ${index + 1}. ${event.name} (${event.event_date})`);
      });
    } else {
      console.log('   ✓ All events have attendees!');
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Verification complete!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await client.end();
  }
}

// Run the verification
verifyResync();
