// Cleanup Duplicate Tickets Script
// Removes duplicate tickets before resync
// Keeps earliest created_at record for each (ticket_id, event_id) combination

import { createRequire } from 'module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const { Client } = pg;

/**
 * Find and remove duplicate tickets
 */
async function cleanupDuplicates() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();
  console.log('🔌 Connected to database\n');

  try {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 DUPLICATE TICKET CLEANUP');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Step 1: Find duplicate ticket_id + event_id combinations
    console.log('Step 1: Finding duplicate tickets...\n');

    const duplicatesQuery = await client.query(`
      SELECT
        ticket_id,
        event_id,
        COUNT(*) as count
      FROM tablecn_attendees
      WHERE ticket_id IS NOT NULL AND ticket_id != ''
      GROUP BY ticket_id, event_id
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
    `);

    const duplicates = duplicatesQuery.rows;

    if (duplicates.length === 0) {
      console.log('✓ No duplicate tickets found!');
      console.log('   Database is clean.\n');
      return { removed: 0, groups: 0 };
    }

    console.log(`Found ${duplicates.length} duplicate groups:\n`);

    let totalDuplicateRecords = 0;
    duplicates.forEach((dup, index) => {
      const extraCopies = dup.count - 1;
      totalDuplicateRecords += extraCopies;

      if (index < 10) { // Show first 10
        console.log(`   ${index + 1}. Ticket ${dup.ticket_id}: ${dup.count} copies (${extraCopies} duplicates)`);
      }
    });

    if (duplicates.length > 10) {
      console.log(`   ... and ${duplicates.length - 10} more groups`);
    }

    console.log(`\n   Total duplicate records to remove: ${totalDuplicateRecords}\n`);

    // Step 2: Confirm with user
    console.log('⚠️  WARNING: This will DELETE duplicate records!');
    console.log('   Only the earliest record for each (ticket_id, event_id) will be kept.');
    console.log('   Press Ctrl+C within 5 seconds to cancel...\n');

    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 3: Delete duplicates (keep earliest created_at)
    console.log('🗑️  Removing duplicates...\n');

    let removedCount = 0;

    for (const duplicate of duplicates) {
      // Find all records for this ticket_id + event_id
      const recordsQuery = await client.query(`
        SELECT id, created_at, first_name, last_name, email
        FROM tablecn_attendees
        WHERE ticket_id = $1 AND event_id = $2
        ORDER BY created_at ASC
      `, [duplicate.ticket_id, duplicate.event_id]);

      const records = recordsQuery.rows;

      if (records.length <= 1) continue;

      // Keep the first (earliest), delete the rest
      const toKeep = records[0];
      const toDelete = records.slice(1);

      console.log(`   Ticket ${duplicate.ticket_id}:`);
      console.log(`     Keeping: ${toKeep.first_name} ${toKeep.last_name} (${toKeep.email}) created ${toKeep.created_at}`);
      console.log(`     Deleting: ${toDelete.length} duplicate(s)`);

      for (const record of toDelete) {
        await client.query(
          `DELETE FROM tablecn_attendees WHERE id = $1`,
          [record.id]
        );
        removedCount++;
      }
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`\n✅ Cleanup complete!`);
    console.log(`   Duplicate groups found: ${duplicates.length}`);
    console.log(`   Duplicate records removed: ${removedCount}`);
    console.log(`   Records kept: ${duplicates.length} (earliest for each group)`);
    console.log(`\n📋 Next steps:`);
    console.log(`   1. Run: pnpm db:generate`);
    console.log(`   2. Run: pnpm db:push`);
    console.log(`   3. Run: node full-historical-resync.mjs`);

    return { removed: removedCount, groups: duplicates.length };

  } catch (error) {
    console.error('Fatal error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the cleanup
cleanupDuplicates();
