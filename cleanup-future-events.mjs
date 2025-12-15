/**
 * Clean up all future events by deleting attendees
 * This removes duplicates before the fixed sync logic runs
 */

import postgres from 'postgres';

const BASE_URL = 'http://localhost:3000';

const sql = postgres(process.env.DATABASE_URL);

async function main() {
  try {
    console.log('🔍 Fetching future events...\n');

    // Get all future events (today and onwards)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const futureEvents = await sql`
      SELECT id, name, event_date
      FROM tablecn_events
      WHERE event_date >= ${today}
        AND merged_into_event_id IS NULL
      ORDER BY event_date
    `;

    console.log(`Found ${futureEvents.length} future events\n`);

    if (futureEvents.length === 0) {
      console.log('No future events to clean up.');
      await sql.end();
      return;
    }

    let totalCleaned = 0;

    for (const event of futureEvents) {
      console.log(`\n📅 ${event.name}`);
      console.log(`   Date: ${event.event_date.toISOString().split('T')[0]}`);
      console.log(`   ID: ${event.id}`);

      // Get current attendee count
      const [count] = await sql`
        SELECT COUNT(*) as count
        FROM tablecn_attendees
        WHERE event_id = ${event.id}
      `;

      console.log(`   Current attendees: ${count.count}`);

      if (count.count === '0') {
        console.log(`   ✓ No attendees to clean`);
        continue;
      }

      // Call cleanup API
      console.log(`   🧹 Cleaning up...`);
      const cleanupResponse = await fetch(`${BASE_URL}/api/cleanup-duplicates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id }),
      });

      if (!cleanupResponse.ok) {
        const error = await cleanupResponse.json();
        console.log(`   ❌ Error: ${error.error}`);
        continue;
      }

      const result = await cleanupResponse.json();
      console.log(`   ✅ Deleted ${count.count} attendees`);
      totalCleaned += parseInt(count.count);
    }

    console.log(`\n\n✅ Cleanup complete!`);
    console.log(`   Total attendees removed: ${totalCleaned}`);
    console.log(`\n📝 Next steps:`);
    console.log(`   1. Navigate to http://localhost:3000`);
    console.log(`   2. Select each event from the dropdown`);
    console.log(`   3. Page load will trigger automatic re-sync with FIXED logic`);
    console.log(`   4. Watch browser console for sync logs`);
    console.log(`   5. Verify no duplicates appear\n`);

    await sql.end();

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
