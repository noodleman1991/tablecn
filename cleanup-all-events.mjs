import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL);

async function main() {
  try {
    // Get all events with WooCommerce product IDs
    const events = await sql`
      SELECT id, name, woocommerce_product_id
      FROM tablecn_events
      WHERE woocommerce_product_id IS NOT NULL
      ORDER BY event_date DESC
    `;

    console.log(`\nFound ${events.length} events with WooCommerce product IDs:\n`);

    for (const event of events) {
      console.log(`Event: ${event.name}`);
      console.log(`  ID: ${event.id}`);
      console.log(`  Product ID: ${event.woocommerce_product_id}`);

      // Get current attendee count
      const [count] = await sql`
        SELECT COUNT(*) as count
        FROM tablecn_attendees
        WHERE event_id = ${event.id}
      `;
      console.log(`  Current attendees: ${count.count}`);

      // Clean up duplicates
      console.log(`  Cleaning up...`);
      await sql`DELETE FROM tablecn_attendees WHERE event_id = ${event.id}`;
      console.log(`  ✓ Deleted all attendees\n`);
    }

    console.log('\n✅ All events cleaned up!');
    console.log('\nNext steps:');
    console.log('1. Navigate to each event in the app');
    console.log('2. Page load will trigger automatic re-sync');
    console.log('3. Verify correct attendee counts\n');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await sql.end();
  }
}

main();
