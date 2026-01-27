#!/usr/bin/env node

/**
 * Recalculate All Memberships Script
 *
 * Recalculates membership status and expiry dates for all members.
 * Uses the same logic as calculate-membership.ts:
 * - Active if 3+ total qualifying events AND 1+ in last 9 months
 * - Expiry is 9 months from last qualifying event
 * - Excludes social events: walk, party, drinks, seasonal celebrations
 *
 * Usage:
 *   DATABASE_URL='...' node scripts/recalculate-all-memberships.mjs [--dry-run]
 *
 * Examples:
 *   DATABASE_URL='...' node scripts/recalculate-all-memberships.mjs --dry-run
 *   DATABASE_URL='...' node scripts/recalculate-all-memberships.mjs
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
  console.error('   Run with: DATABASE_URL=\'your_url\' node scripts/recalculate-all-memberships.mjs [--dry-run]');
  process.exit(1);
}

/**
 * Check if event is a social event (not counted toward membership)
 * Matches logic in src/lib/calculate-membership.ts
 */
function isSocialEvent(eventName) {
  const lowerName = eventName.toLowerCase();

  // Existing exclusions
  if (lowerName.includes("walk") || lowerName.includes("party") || lowerName.includes("drinks")) {
    return true;
  }

  // Seasonal celebrations (season + celebration together)
  const seasons = ["winter", "spring", "summer", "autumn", "fall", "solstice", "equinox"];
  const hasSeasonWord = seasons.some(season => lowerName.includes(season));
  const hasCelebration = lowerName.includes("celebration");

  if (hasSeasonWord && hasCelebration) {
    return true;
  }

  return false;
}

async function main() {
  console.log('');
  console.log('🔄 Recalculate All Memberships Script');
  console.log('=====================================');
  console.log(`🔧 Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE (will update members)'}`);
  console.log('');

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    // Get all members
    const membersResult = await client.query(`
      SELECT id, email, first_name, last_name, is_active_member, total_events_attended,
             membership_expires_at, last_event_date, manually_added, manual_expires_at
      FROM tablecn_members
      ORDER BY email
    `);
    const members = membersResult.rows;

    console.log(`📊 Found ${members.length} members to recalculate`);
    console.log('');

    // Calculate 9 months ago from today
    const nineMonthsAgo = new Date();
    nineMonthsAgo.setMonth(nineMonthsAgo.getMonth() - 9);

    let updatedCount = 0;
    let unchangedCount = 0;
    let errorCount = 0;
    const changes = [];

    for (const member of members) {
      try {
        // Get ALL checked-in events for this member
        const allEventsResult = await client.query(`
          SELECT e.id, e.name, e.event_date
          FROM tablecn_attendees a
          INNER JOIN tablecn_events e ON a.event_id = e.id
          WHERE a.email = $1 AND a.checked_in = true
          ORDER BY e.event_date DESC
        `, [member.email]);

        const allEvents = allEventsResult.rows;

        // Filter out social events
        const countableAllEvents = allEvents.filter(e => !isSocialEvent(e.name));
        const countableRecentEvents = countableAllEvents.filter(e =>
          new Date(e.event_date) >= nineMonthsAgo
        );

        const totalEventsAttended = countableAllEvents.length;
        const recentEventsAttended = countableRecentEvents.length;

        // Active if 3+ total events AND 1+ event in last 9 months
        const isActiveMember = totalEventsAttended >= 3 && recentEventsAttended >= 1;

        // Calculate expiry (9 months from last countable event)
        let membershipExpiresAt = null;
        let lastEventDate = null;

        const lastCountableEvent = countableAllEvents[0];
        if (lastCountableEvent) {
          lastEventDate = new Date(lastCountableEvent.event_date);
          membershipExpiresAt = new Date(lastEventDate);
          membershipExpiresAt.setMonth(membershipExpiresAt.getMonth() + 9);
        }

        // Handle manually added members
        if (member.manually_added && member.manual_expires_at && membershipExpiresAt) {
          const manualExpiry = new Date(member.manual_expires_at);
          if (manualExpiry > membershipExpiresAt) {
            membershipExpiresAt = manualExpiry;
          }
        } else if (member.manually_added && member.manual_expires_at && !membershipExpiresAt) {
          membershipExpiresAt = new Date(member.manual_expires_at);
        }

        // Check if anything changed
        const oldExpiry = member.membership_expires_at ? new Date(member.membership_expires_at).toISOString().split('T')[0] : null;
        const newExpiry = membershipExpiresAt ? membershipExpiresAt.toISOString().split('T')[0] : null;
        const oldLastEvent = member.last_event_date ? new Date(member.last_event_date).toISOString().split('T')[0] : null;
        const newLastEvent = lastEventDate ? lastEventDate.toISOString().split('T')[0] : null;

        const hasChanged =
          member.is_active_member !== isActiveMember ||
          member.total_events_attended !== totalEventsAttended ||
          oldExpiry !== newExpiry ||
          oldLastEvent !== newLastEvent;

        if (hasChanged) {
          changes.push({
            email: member.email,
            oldActive: member.is_active_member,
            newActive: isActiveMember,
            oldTotal: member.total_events_attended,
            newTotal: totalEventsAttended,
            oldExpiry,
            newExpiry,
            oldLastEvent,
            newLastEvent,
          });

          if (!dryRun) {
            await client.query(`
              UPDATE tablecn_members
              SET is_active_member = $1,
                  total_events_attended = $2,
                  membership_expires_at = $3,
                  last_event_date = $4,
                  updated_at = NOW()
              WHERE id = $5
            `, [isActiveMember, totalEventsAttended, membershipExpiresAt, lastEventDate, member.id]);
          }

          updatedCount++;
        } else {
          unchangedCount++;
        }
      } catch (error) {
        errorCount++;
        console.log(`   ❌ ${member.email}: ${error.message}`);
      }
    }

    console.log('📋 Changes:');
    if (changes.length === 0) {
      console.log('   No changes needed');
    } else {
      changes.forEach(c => {
        const expiryChange = c.oldExpiry !== c.newExpiry ? ` expiry: ${c.oldExpiry} → ${c.newExpiry}` : '';
        const activeChange = c.oldActive !== c.newActive ? ` active: ${c.oldActive} → ${c.newActive}` : '';
        const totalChange = c.oldTotal !== c.newTotal ? ` events: ${c.oldTotal} → ${c.newTotal}` : '';
        console.log(`   - ${c.email}:${activeChange}${totalChange}${expiryChange}`);
      });
    }

    console.log('');
    console.log('📊 Results:');
    console.log(`   ${dryRun ? '🔍 Would update' : '✅ Updated'}: ${updatedCount}`);
    console.log(`   ⏭️  Unchanged: ${unchangedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log('');

    if (dryRun) {
      console.log('💡 Run without --dry-run to actually update members');
    }

    console.log('✨ Done!');

  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
