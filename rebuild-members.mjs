// Rebuild Community Members Script
// Truncates and rebuilds the entire tablecn_members table
// Creates member records from attendee data with accurate attendance counts

import { createRequire } from 'module';
import pg from 'pg';
import { customAlphabet } from 'nanoid';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const { Client } = pg;

// ID generator (matching src/lib/id.ts)
const generateId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  12
);

// Social event keywords to exclude from attendance counts
const SOCIAL_EVENT_KEYWORDS = ['walk', 'party', 'drinks', 'social'];

/**
 * Check if event is a social event (excluded from attendance counts)
 */
function isSocialEvent(eventName) {
  const nameLower = eventName.toLowerCase();
  return SOCIAL_EVENT_KEYWORDS.some(keyword => nameLower.includes(keyword));
}

/**
 * Rebuild members table from attendee data
 */
async function rebuildMembers(client) {
  console.log('🗑️  Truncating tablecn_members table...');
  await client.query('TRUNCATE tablecn_members CASCADE');
  console.log('✓ Members table cleared\n');

  // Get all unique ticket holder emails with their info
  console.log('📧 Fetching unique attendee emails...');
  const uniqueAttendeesResult = await client.query(`
    SELECT DISTINCT ON (email)
      email,
      first_name,
      last_name
    FROM tablecn_attendees
    WHERE email IS NOT NULL AND email != ''
    ORDER BY email, created_at DESC
  `);

  const uniqueAttendees = uniqueAttendeesResult.rows;
  console.log(`Found ${uniqueAttendees.length} unique emails\n`);

  let membersCreated = 0;
  let activeMembersCount = 0;

  for (let i = 0; i < uniqueAttendees.length; i++) {
    const attendee = uniqueAttendees[i];

    if ((i + 1) % 50 === 0) {
      console.log(`Processing member ${i + 1}/${uniqueAttendees.length}...`);
    }

    // Get all events this person attended (checked in)
    const eventsResult = await client.query(`
      SELECT DISTINCT e.id, e.name, e.event_date, a.checked_in_at
      FROM tablecn_attendees a
      JOIN tablecn_events e ON a.event_id = e.id
      WHERE a.email = $1 AND a.checked_in = true
      ORDER BY e.event_date DESC
    `, [attendee.email]);

    // Filter out social events
    const nonSocialEvents = eventsResult.rows.filter(e => !isSocialEvent(e.name));

    const totalEventsAttended = nonSocialEvents.length;
    const lastEventDate = nonSocialEvents[0]?.event_date || null;

    // Count events in last 9 months
    const nineMonthsAgo = new Date();
    nineMonthsAgo.setMonth(nineMonthsAgo.getMonth() - 9);

    const recentEvents = nonSocialEvents.filter(e =>
      new Date(e.event_date) >= nineMonthsAgo
    );

    // Determine active status (3+ events total AND 1+ in last 9 months)
    const isActiveMember = totalEventsAttended >= 3 && recentEvents.length >= 1;

    if (isActiveMember) {
      activeMembersCount++;
    }

    // Calculate membership expiration (9 months from last event)
    const membershipExpiresAt = lastEventDate
      ? new Date(new Date(lastEventDate).setMonth(
          new Date(lastEventDate).getMonth() + 9
        ))
      : null;

    // Insert member
    await client.query(`
      INSERT INTO tablecn_members (
        id, email, first_name, last_name,
        is_active_member, total_events_attended,
        membership_expires_at, last_event_date,
        manually_added
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      generateId(),
      attendee.email,
      attendee.first_name,
      attendee.last_name,
      isActiveMember,
      totalEventsAttended,
      membershipExpiresAt,
      lastEventDate,
      false
    ]);

    membersCreated++;
  }

  return {
    total: membersCreated,
    active: activeMembersCount,
    inactive: membersCreated - activeMembersCount
  };
}

/**
 * Main function
 */
async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();
  console.log('🔌 Connected to database\n');

  try {
    console.log('⚠️  WARNING: This will DELETE ALL existing member data!');
    console.log('Press Ctrl+C within 5 seconds to cancel...\n');

    await new Promise(resolve => setTimeout(resolve, 5000));

    const result = await rebuildMembers(client);

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`\n✅ Members rebuild complete!`);
    console.log(`   Total members created: ${result.total}`);
    console.log(`   Active members: ${result.active}`);
    console.log(`   Inactive members: ${result.inactive}`);
    console.log(`\n📋 Next step:`);
    console.log(`   Run: node verify-resync.mjs`);

  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await client.end();
  }
}

// Run the script
main();
