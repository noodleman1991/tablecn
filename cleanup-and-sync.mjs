/**
 * Script to clean up and re-sync all events
 * This calls the cleanup API for each event with a WooCommerce product ID
 */

const BASE_URL = 'http://localhost:3000';

async function main() {
  try {
    console.log('🔍 Fetching list of events...\n');

    // Get list of events from the app
    const eventsResponse = await fetch(`${BASE_URL}/api/events`);
    if (!eventsResponse.ok) {
      throw new Error(`Failed to fetch events: ${eventsResponse.statusText}`);
    }

    const eventsData = await eventsResponse.json();
    const events = eventsData.events || eventsData;

    // Filter events with WooCommerce product IDs
    const wooEvents = events.filter(e => e.woocommerceProductId);

    console.log(`Found ${wooEvents.length} events with WooCommerce integration:\n`);

    for (const event of wooEvents) {
      console.log(`\n📅 Event: ${event.name}`);
      console.log(`   ID: ${event.id}`);
      console.log(`   Product ID: ${event.woocommerceProductId}`);

      // Call cleanup API
      console.log(`   🧹 Cleaning up duplicates...`);
      const cleanupResponse = await fetch(`${BASE_URL}/api/cleanup-duplicates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id }),
      });

      if (!cleanupResponse.ok) {
        const error = await cleanupResponse.json();
        console.log(`   ❌ Error: ${error.error || cleanupResponse.statusText}`);
        continue;
      }

      const result = await cleanupResponse.json();
      console.log(`   ✅ ${result.message}`);
    }

    console.log(`\n\n✅ All events cleaned up!`);
    console.log(`\n📝 Next steps:`);
    console.log(`   1. Navigate to http://localhost:3000`);
    console.log(`   2. Click through each event in the dropdown`);
    console.log(`   3. Page load will trigger automatic re-sync`);
    console.log(`   4. Verify correct attendee counts in the console logs\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
