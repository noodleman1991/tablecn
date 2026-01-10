#!/usr/bin/env node
/**
 * Comprehensive Data Quality Audit Script
 *
 * PURPOSE: Identify all data quality issues in the events/attendees system
 * - Missing tickets in events
 * - Duplicate ticket records
 * - Date mismatches
 *
 * OUTPUT: Detailed reports + CSV files for analysis
 * SAFETY: 100% read-only, zero database modifications
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

// Results storage
const auditResults = {
  summary: {
    totalEvents: 0,
    eventsWithProducts: 0,
    eventsWithZeroTickets: 0,
    eventsWithTickets: 0,
    totalTickets: 0,
    totalDuplicates: 0,
    totalDateIssues: 0,
  },
  emptyEvents: [],
  duplicatesWithinEvent: [],
  duplicatesAcrossEvents: [],
  purchasesAfterEvent: [],
  earlyBirdTickets: [],
  suspiciousEvents: [],
};

console.log('🔍 COMPREHENSIVE DATA QUALITY AUDIT');
console.log('========================================\n');
console.log('Starting audit... This may take a few minutes.\n');

/**
 * Query 1: System-wide statistics
 */
async function gatherSystemStats() {
  console.log('📊 Gathering system-wide statistics...');

  const stats = await pool.query(`
    SELECT
      COUNT(DISTINCT e.id) as total_events,
      COUNT(DISTINCT e.id) FILTER (WHERE e.woocommerce_product_id IS NOT NULL) as events_with_products,
      COUNT(DISTINCT e.id) FILTER (WHERE ticket_count = 0 AND e.woocommerce_product_id IS NOT NULL) as events_with_zero,
      COUNT(DISTINCT e.id) FILTER (WHERE ticket_count > 0) as events_with_tickets,
      COALESCE(SUM(ticket_count), 0) as total_tickets
    FROM tablecn_events e
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int as ticket_count
      FROM tablecn_attendees a
      WHERE a.event_id = e.id
    ) counts ON true
  `);

  auditResults.summary = {
    totalEvents: parseInt(stats.rows[0].total_events),
    eventsWithProducts: parseInt(stats.rows[0].events_with_products),
    eventsWithZeroTickets: parseInt(stats.rows[0].events_with_zero),
    eventsWithTickets: parseInt(stats.rows[0].events_with_tickets),
    totalTickets: parseInt(stats.rows[0].total_tickets),
  };

  console.log(`  ✓ Found ${auditResults.summary.totalEvents} total events`);
  console.log(`  ✓ ${auditResults.summary.eventsWithProducts} events have WooCommerce products`);
  console.log(`  ✓ ${auditResults.summary.totalTickets} total tickets in database\n`);
}

/**
 * Query 2: Find events with zero tickets
 */
async function findEmptyEvents() {
  console.log('🔍 Finding events with zero tickets...');

  const emptyEvents = await pool.query(`
    SELECT
      e.id,
      e.name,
      e.event_date,
      e.woocommerce_product_id,
      e.created_at
    FROM tablecn_events e
    LEFT JOIN tablecn_attendees a ON a.event_id = e.id
    WHERE e.woocommerce_product_id IS NOT NULL
    GROUP BY e.id, e.name, e.event_date, e.woocommerce_product_id, e.created_at
    HAVING COUNT(a.id) = 0
    ORDER BY e.event_date DESC
  `);

  auditResults.emptyEvents = emptyEvents.rows;
  console.log(`  ✓ Found ${emptyEvents.rows.length} events with 0 tickets\n`);
}

/**
 * Query 3: Find duplicate tickets within same event
 */
async function findDuplicatesWithinEvent() {
  console.log('🔍 Finding duplicate tickets within same event...');

  const duplicates = await pool.query(`
    SELECT
      e.id as event_id,
      e.name as event_name,
      a.ticket_id,
      COUNT(*) as duplicate_count,
      array_agg(a.id) as attendee_ids,
      array_agg(a.email) as emails,
      array_agg(a.created_at) as created_dates
    FROM tablecn_attendees a
    JOIN tablecn_events e ON a.event_id = e.id
    WHERE a.ticket_id IS NOT NULL AND a.ticket_id != ''
    GROUP BY e.id, e.name, a.ticket_id
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, e.name
  `);

  auditResults.duplicatesWithinEvent = duplicates.rows;
  auditResults.summary.totalDuplicates += duplicates.rows.length;
  console.log(`  ✓ Found ${duplicates.rows.length} duplicate tickets within events\n`);
}

/**
 * Query 4: Find tickets appearing in multiple events
 */
async function findDuplicatesAcrossEvents() {
  console.log('🔍 Finding tickets appearing in multiple events...');

  const crossDuplicates = await pool.query(`
    SELECT
      a.ticket_id,
      COUNT(DISTINCT a.event_id) as event_count,
      array_agg(DISTINCT e.id) as event_ids,
      array_agg(DISTINCT e.name) as event_names,
      array_agg(DISTINCT e.woocommerce_product_id) as product_ids
    FROM tablecn_attendees a
    JOIN tablecn_events e ON a.event_id = e.id
    WHERE a.ticket_id IS NOT NULL AND a.ticket_id != ''
    GROUP BY a.ticket_id
    HAVING COUNT(DISTINCT a.event_id) > 1
    ORDER BY COUNT(DISTINCT a.event_id) DESC
  `);

  auditResults.duplicatesAcrossEvents = crossDuplicates.rows;
  console.log(`  ✓ Found ${crossDuplicates.rows.length} tickets appearing in multiple events\n`);
}

/**
 * Query 5: Find purchases made AFTER event date (wrong event association)
 */
async function findPurchasesAfterEvent() {
  console.log('🔍 Finding purchases made after event date...');

  const afterEvent = await pool.query(`
    SELECT
      e.id as event_id,
      e.name as event_name,
      e.event_date,
      MIN(a.woocommerce_order_date) as first_purchase,
      MAX(a.woocommerce_order_date) as last_purchase,
      COUNT(a.id) as ticket_count,
      COUNT(a.id) FILTER (WHERE a.woocommerce_order_date > e.event_date) as tickets_after_event
    FROM tablecn_events e
    JOIN tablecn_attendees a ON a.event_id = e.id
    WHERE a.woocommerce_order_date IS NOT NULL
      AND a.woocommerce_order_date > e.event_date
    GROUP BY e.id, e.name, e.event_date
    ORDER BY COUNT(a.id) FILTER (WHERE a.woocommerce_order_date > e.event_date) DESC
  `);

  auditResults.purchasesAfterEvent = afterEvent.rows;
  auditResults.summary.totalDateIssues += afterEvent.rows.length;
  console.log(`  ✓ Found ${afterEvent.rows.length} events with tickets purchased after event date\n`);
}

/**
 * Query 6: Find suspiciously early purchases (>365 days before event)
 */
async function findEarlyBirdTickets() {
  console.log('🔍 Finding suspiciously early ticket purchases...');

  const earlyBird = await pool.query(`
    SELECT
      e.id as event_id,
      e.name as event_name,
      e.event_date,
      MIN(a.woocommerce_order_date) as first_purchase,
      (e.event_date - MIN(a.woocommerce_order_date))::interval as days_in_advance,
      COUNT(a.id) as ticket_count
    FROM tablecn_events e
    JOIN tablecn_attendees a ON a.event_id = e.id
    WHERE a.woocommerce_order_date IS NOT NULL
      AND (e.event_date - a.woocommerce_order_date) > interval '365 days'
    GROUP BY e.id, e.name, e.event_date
    ORDER BY (e.event_date - MIN(a.woocommerce_order_date)) DESC
  `);

  auditResults.earlyBirdTickets = earlyBird.rows;
  console.log(`  ✓ Found ${earlyBird.rows.length} events with tickets purchased >1 year early\n`);
}

/**
 * Query 7: Find events with only 1 ticket (suspicious)
 */
async function findSuspiciousEvents() {
  console.log('🔍 Finding events with only 1 ticket...');

  const suspicious = await pool.query(`
    SELECT
      e.id,
      e.name,
      e.event_date,
      e.woocommerce_product_id,
      COUNT(a.id) as ticket_count
    FROM tablecn_events e
    JOIN tablecn_attendees a ON a.event_id = e.id
    GROUP BY e.id, e.name, e.event_date, e.woocommerce_product_id
    HAVING COUNT(a.id) = 1
    ORDER BY e.event_date DESC
  `);

  auditResults.suspiciousEvents = suspicious.rows;
  console.log(`  ✓ Found ${suspicious.rows.length} events with exactly 1 ticket\n`);
}

/**
 * Generate human-readable report
 */
function generateTextReport() {
  let report = '';

  report += '═══════════════════════════════════════════════\n';
  report += '  COMPREHENSIVE DATA QUALITY AUDIT REPORT\n';
  report += '═══════════════════════════════════════════════\n\n';
  report += `Generated: ${new Date().toISOString()}\n\n`;

  // Summary
  report += '📊 SUMMARY STATISTICS\n';
  report += '─────────────────────────────────────────────\n';
  report += `Total Events:              ${auditResults.summary.totalEvents}\n`;
  report += `Events with Products:      ${auditResults.summary.eventsWithProducts}\n`;
  report += `Events with Tickets:       ${auditResults.summary.eventsWithTickets}\n`;
  report += `Events with 0 Tickets:     ${auditResults.summary.eventsWithZeroTickets}\n`;
  report += `Total Tickets:             ${auditResults.summary.totalTickets}\n\n`;

  // Critical Issues
  report += '❌ CRITICAL ISSUES\n';
  report += '─────────────────────────────────────────────\n';
  report += `Empty Events:              ${auditResults.emptyEvents.length}\n`;
  report += `  Events that should have tickets but show 0\n\n`;

  // Warnings
  report += '⚠️  WARNINGS\n';
  report += '─────────────────────────────────────────────\n';
  report += `Duplicate Tickets (Same Event):    ${auditResults.duplicatesWithinEvent.length}\n`;
  report += `Duplicate Tickets (Cross-Event):   ${auditResults.duplicatesAcrossEvents.length}\n`;
  report += `Suspicious Events (1 ticket):      ${auditResults.suspiciousEvents.length}\n\n`;

  // Info
  report += '🔍 INFORMATIONAL\n';
  report += '─────────────────────────────────────────────\n';
  report += `Purchases After Event:     ${auditResults.purchasesAfterEvent.length}\n`;
  report += `Very Early Purchases:      ${auditResults.earlyBirdTickets.length}\n\n`;

  // Details
  if (auditResults.emptyEvents.length > 0) {
    report += '\n📋 EMPTY EVENTS (First 10)\n';
    report += '─────────────────────────────────────────────\n';
    auditResults.emptyEvents.slice(0, 10).forEach(e => {
      report += `${e.name.substring(0, 50)}\n`;
      report += `  Event Date: ${e.event_date}\n`;
      report += `  Product ID: ${e.woocommerce_product_id}\n`;
      report += `  Event ID: ${e.id}\n\n`;
    });
  }

  if (auditResults.duplicatesWithinEvent.length > 0) {
    report += '\n📋 DUPLICATE TICKETS (First 10)\n';
    report += '─────────────────────────────────────────────\n';
    auditResults.duplicatesWithinEvent.slice(0, 10).forEach(d => {
      report += `${d.event_name.substring(0, 50)}\n`;
      report += `  Ticket ID: ${d.ticket_id}\n`;
      report += `  Duplicates: ${d.duplicate_count} copies\n`;
      report += `  Emails: ${d.emails.slice(0, 2).join(', ')}\n\n`;
    });
  }

  if (auditResults.purchasesAfterEvent.length > 0) {
    report += '\n📋 PURCHASES AFTER EVENT (First 10)\n';
    report += '─────────────────────────────────────────────\n';
    auditResults.purchasesAfterEvent.slice(0, 10).forEach(e => {
      report += `${e.event_name.substring(0, 50)}\n`;
      report += `  Event Date: ${e.event_date}\n`;
      report += `  First Purchase: ${e.first_purchase}\n`;
      report += `  Tickets After Event: ${e.tickets_after_event}/${e.ticket_count}\n\n`;
    });
  }

  report += '\n═══════════════════════════════════════════════\n';
  report += 'END OF REPORT\n';
  report += '═══════════════════════════════════════════════\n';

  return report;
}

/**
 * Export CSV files
 */
function exportCSV() {
  console.log('📁 Generating CSV exports...\n');

  // Empty events CSV
  if (auditResults.emptyEvents.length > 0) {
    const csv = [
      'event_id,event_name,event_date,woocommerce_product_id,created_at',
      ...auditResults.emptyEvents.map(e =>
        `${e.id},"${e.name.replace(/"/g, '""')}",${e.event_date},${e.woocommerce_product_id},${e.created_at}`
      )
    ].join('\n');
    fs.writeFileSync('audit-empty-events.csv', csv);
    console.log('  ✓ audit-empty-events.csv');
  }

  // Duplicates within event CSV
  if (auditResults.duplicatesWithinEvent.length > 0) {
    const csv = [
      'event_id,event_name,ticket_id,duplicate_count,attendee_ids,emails',
      ...auditResults.duplicatesWithinEvent.map(d =>
        `${d.event_id},"${d.event_name.replace(/"/g, '""')}",${d.ticket_id},${d.duplicate_count},"${d.attendee_ids.join(',')}","${d.emails.join(',')}"`
      )
    ].join('\n');
    fs.writeFileSync('audit-duplicates.csv', csv);
    console.log('  ✓ audit-duplicates.csv');
  }

  // Date issues CSV
  if (auditResults.purchasesAfterEvent.length > 0) {
    const csv = [
      'event_id,event_name,event_date,first_purchase,tickets_after_event,total_tickets',
      ...auditResults.purchasesAfterEvent.map(e =>
        `${e.event_id},"${e.event_name.replace(/"/g, '""')}",${e.event_date},${e.first_purchase},${e.tickets_after_event},${e.ticket_count}`
      )
    ].join('\n');
    fs.writeFileSync('audit-date-issues.csv', csv);
    console.log('  ✓ audit-date-issues.csv');
  }

  // Summary JSON
  fs.writeFileSync('audit-summary.json', JSON.stringify(auditResults, null, 2));
  console.log('  ✓ audit-summary.json\n');
}

/**
 * Main audit execution
 */
async function runAudit() {
  try {
    await gatherSystemStats();
    await findEmptyEvents();
    await findDuplicatesWithinEvent();
    await findDuplicatesAcrossEvents();
    await findPurchasesAfterEvent();
    await findEarlyBirdTickets();
    await findSuspiciousEvents();

    console.log('═══════════════════════════════════════════════\n');
    console.log('📊 AUDIT COMPLETE\n');
    console.log('═══════════════════════════════════════════════\n');

    // Generate reports
    const textReport = generateTextReport();
    fs.writeFileSync('audit-report.txt', textReport);
    console.log('  ✓ audit-report.txt');

    exportCSV();

    // Print summary to console
    console.log('\n' + textReport);

    console.log('\n💡 NEXT STEPS:\n');
    console.log('1. Review audit-report.txt for detailed findings');
    console.log('2. Examine CSV files for specific issues');
    console.log('3. Decide which issues to fix first');
    console.log('4. Run repair script (to be implemented)\n');

  } catch (error) {
    console.error('❌ Audit failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the audit
runAudit().catch(console.error);
