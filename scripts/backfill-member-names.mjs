#!/usr/bin/env node

/**
 * Backfill Member Names Script
 *
 * Updates members with missing first/last names using data from the attendees table.
 * Uses the most recent attendee record for each member to get the name.
 *
 * Usage:
 *   DATABASE_URL='...' node scripts/backfill-member-names.mjs [--dry-run]
 *
 * Examples:
 *   DATABASE_URL='...' node scripts/backfill-member-names.mjs --dry-run
 *   DATABASE_URL='...' node scripts/backfill-member-names.mjs
 */

import pg from 'pg';
const { Client } = pg;

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

// Get database URL from environment
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is required');
  console.error('   Run with: DATABASE_URL=\'your_url\' node scripts/backfill-member-names.mjs [--dry-run]');
  process.exit(1);
}

async function main() {
  console.log('');
  console.log('👤 Backfill Member Names Script');
  console.log('================================');
  console.log(`🔧 Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE (will update members)'}`);
  console.log('');

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    // Find members with missing names who have attendee records with names
    const findQuery = `
      SELECT
        m.id as member_id,
        m.email,
        m.first_name as member_first_name,
        m.last_name as member_last_name,
        a.first_name as attendee_first_name,
        a.last_name as attendee_last_name
      FROM tablecn_members m
      INNER JOIN (
        SELECT DISTINCT ON (email)
          email,
          first_name,
          last_name,
          created_at
        FROM tablecn_attendees
        WHERE first_name IS NOT NULL AND first_name != ''
        ORDER BY email, created_at DESC
      ) a ON m.email = a.email
      WHERE (m.first_name IS NULL OR m.first_name = '')
      ORDER BY m.email
    `;

    const result = await client.query(findQuery);
    const membersToUpdate = result.rows;

    console.log(`📊 Found ${membersToUpdate.length} members with missing names`);
    console.log('');

    if (membersToUpdate.length === 0) {
      console.log('✨ No members need updating. All done!');
      return;
    }

    // Display members to update
    console.log('📋 Members to update:');
    membersToUpdate.forEach(m => {
      console.log(`   - ${m.email}: "${m.attendee_first_name} ${m.attendee_last_name}"`);
    });
    console.log('');

    if (dryRun) {
      console.log('🔍 DRY RUN - No changes made');
      console.log('💡 Run without --dry-run to actually update members');
      return;
    }

    // Update members
    console.log('🚀 Updating members...');
    let successCount = 0;
    let errorCount = 0;

    for (const member of membersToUpdate) {
      try {
        await client.query(
          `UPDATE tablecn_members
           SET first_name = $1, last_name = $2, updated_at = NOW()
           WHERE id = $3`,
          [member.attendee_first_name, member.attendee_last_name, member.member_id]
        );
        successCount++;
        console.log(`   ✅ ${member.email}: ${member.attendee_first_name} ${member.attendee_last_name}`);
      } catch (error) {
        errorCount++;
        console.log(`   ❌ ${member.email}: ${error.message}`);
      }
    }

    console.log('');
    console.log('📊 Results:');
    console.log(`   ✅ Successfully updated: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log('');
    console.log('✨ Done!');

  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
