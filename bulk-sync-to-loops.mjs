#!/usr/bin/env node
/**
 * Bulk Sync to Loops.so
 *
 * Syncs all active members to your "Active Community Members" list
 * Removes all inactive members from the list
 *
 * Run this after:
 * 1. Resync completes
 * 2. You run rebuild-members.mjs
 * 3. You've renamed your list to "Active Community Members" in Loops.so
 */

import { createRequire } from 'module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const { Client } = pg;

const LOOPS_API_KEY = process.env.LOOPS_API_KEY;
const LOOPS_LIST_ID = process.env.LOOPS_ACTIVE_MEMBERS_LIST_ID;
const RATE_LIMIT_PER_SECOND = 10;

console.log('🚀 Bulk Sync to Loops.so\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (!LOOPS_LIST_ID) {
  console.error('❌ LOOPS_ACTIVE_MEMBERS_LIST_ID not found in .env');
  console.error('   Please run: node update-loops-list-config.mjs');
  process.exit(1);
}

// Rate limiter
let requestsThisSecond = 0;
let rateLimitResetTime = Date.now() + 1000;

async function rateLimitedRequest(fn) {
  const now = Date.now();

  if (now >= rateLimitResetTime) {
    requestsThisSecond = 0;
    rateLimitResetTime = now + 1000;
  }

  if (requestsThisSecond >= RATE_LIMIT_PER_SECOND) {
    const waitTime = rateLimitResetTime - now;
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return rateLimitedRequest(fn);
  }

  requestsThisSecond++;
  return await fn();
}

async function syncMember(member) {
  return rateLimitedRequest(async () => {
    const response = await fetch('https://app.loops.so/api/v1/contacts/update', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOOPS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: member.email,
        firstName: member.first_name || '',
        lastName: member.last_name || '',
        totalEventsAttended: member.total_events_attended,
        lastEventDate: member.last_event_date,
        membershipExpiresAt: member.membership_expires_at,
        manuallyAdded: member.manually_added,
        source: 'community_member',
        mailingLists: {
          [LOOPS_LIST_ID]: true, // Add to list
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  });
}

async function removeMember(member) {
  return rateLimitedRequest(async () => {
    const response = await fetch('https://app.loops.so/api/v1/contacts/update', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOOPS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: member.email,
        mailingLists: {
          [LOOPS_LIST_ID]: false, // Remove from list
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  });
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

await client.connect();
console.log('✓ Connected to database\n');

try {
  // Get all members
  const result = await client.query(`
    SELECT
      id, email, first_name, last_name,
      is_active_member, total_events_attended,
      last_event_date, membership_expires_at, manually_added
    FROM tablecn_members
    ORDER BY is_active_member DESC, total_events_attended DESC
  `);

  const allMembers = result.rows;
  const activeMembers = allMembers.filter(m => m.is_active_member);
  const inactiveMembers = allMembers.filter(m => !m.is_active_member);

  console.log(`Found ${allMembers.length} total members:`);
  console.log(`  • ${activeMembers.length} active (will be added to list)`);
  console.log(`  • ${inactiveMembers.length} inactive (will be removed from list)\n`);

  const stats = {
    activeSynced: 0,
    inactiveRemoved: 0,
    errors: 0,
  };

  const startTime = Date.now();

  // Sync active members
  console.log('📤 Syncing active members to list...');
  for (const member of activeMembers) {
    try {
      await syncMember(member);
      stats.activeSynced++;

      if (stats.activeSynced % 10 === 0) {
        console.log(`   Progress: ${stats.activeSynced}/${activeMembers.length}`);
      }
    } catch (error) {
      console.error(`   ✗ Failed to sync ${member.email}:`, error.message);
      stats.errors++;
    }
  }

  console.log(`✓ Synced ${stats.activeSynced} active members\n`);

  // Remove inactive members
  console.log('📥 Removing inactive members from list...');
  for (const member of inactiveMembers) {
    try {
      await removeMember(member);
      stats.inactiveRemoved++;

      if (stats.inactiveRemoved % 10 === 0) {
        console.log(`   Progress: ${stats.inactiveRemoved}/${inactiveMembers.length}`);
      }
    } catch (error) {
      console.error(`   ✗ Failed to remove ${member.email}:`, error.message);
      stats.errors++;
    }
  }

  console.log(`✓ Removed ${stats.inactiveRemoved} inactive members\n`);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n✅ Bulk sync complete!\n');
  console.log('📊 Summary:');
  console.log(`   • Active members synced: ${stats.activeSynced}/${activeMembers.length}`);
  console.log(`   • Inactive members removed: ${stats.inactiveRemoved}/${inactiveMembers.length}`);
  console.log(`   • Errors: ${stats.errors}`);
  console.log(`   • Duration: ${duration}s\n`);

  console.log('🎯 Next steps:');
  console.log('   1. Check your Loops.so dashboard');
  console.log('   2. Verify "Active Community Members" list has the right contacts');
  console.log('   3. Create email campaigns targeting this list');

} catch (error) {
  console.error('\n❌ Fatal error:', error);
} finally {
  await client.end();
}
