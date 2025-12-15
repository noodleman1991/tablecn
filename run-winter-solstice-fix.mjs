/**
 * Run the complete fix for Winter Solstice event
 */

const BASE_URL = 'http://localhost:3000';

async function main() {
  console.log('🔍 Finding Winter Solstice event...\n');

  try {
    // Step 1: Get the event ID
    // We'll need to check the database directly via a query
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const postgres = (await import('postgres')).default;
    const { events, attendees } = await import('./src/db/schema.ts');
    const { like, eq } = await import('drizzle-orm');

    const sql = postgres(process.env.DATABASE_URL);
    const db = drizzle(sql);

    const winterSolsticeEvents = await db
      .select()
      .from(events)
      .where(like(events.name, '%Winter Solstice%'))
      .limit(1);

    if (winterSolsticeEvents.length === 0) {
      console.log('❌ Winter Solstice event not found in database');
      process.exit(1);
    }

    const event = winterSolsticeEvents[0];
    console.log(`✅ Found: ${event.name}`);
    console.log(`   Event ID: ${event.id}`);
    console.log(`   Product ID: ${event.woocommerceProductId}\n`);

    // Step 2: Get current attendee count
    const currentAttendees = await db
      .select()
      .from(attendees)
      .where(eq(attendees.eventId, event.id));

    console.log(`📊 Current attendee count: ${currentAttendees.length}\n`);

    // Step 3: Clean up duplicates
    console.log('🧹 Cleaning up duplicates...');
    const cleanupResponse = await fetch(`${BASE_URL}/api/cleanup-duplicates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: event.id }),
    });

    if (!cleanupResponse.ok) {
      const error = await cleanupResponse.json();
      console.log(`❌ Cleanup failed: ${error.error}`);
      process.exit(1);
    }

    const cleanupResult = await cleanupResponse.json();
    console.log(`✅ ${cleanupResult.message}\n`);

    // Step 4: Verify cleanup
    const afterCleanup = await db
      .select()
      .from(attendees)
      .where(eq(attendees.eventId, event.id));

    console.log(`📊 Attendees after cleanup: ${afterCleanup.length}`);
    console.log(`   (Should be 0)\n`);

    // Step 5: Instructions to trigger re-sync
    console.log('📝 Next steps to trigger re-sync:\n');
    console.log(`   1. Open http://localhost:3000/?eventId=${event.id}`);
    console.log('   2. Page load will automatically trigger sync');
    console.log('   3. Watch the browser console for debug logs');
    console.log('   4. Look for logs like:');
    console.log('      [DEBUG] Extracted ticket: uid=..., ticketId=17577, email=...');
    console.log('      [sync-attendees] Sync complete: 36 created, 0 updated');
    console.log('   5. Verify the attendee count shows 36\n');

    console.log('🎯 Expected results:');
    console.log('   - Exactly 36 attendees (matching CSV)');
    console.log('   - Multi-ticket orders show different names/emails');
    console.log('   - Ticket IDs are actual WooCommerce IDs (17577, 17578, etc.)\n');

    await sql.end();

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
