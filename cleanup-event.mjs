import pg from 'pg';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const dotenv = require('dotenv');
dotenv.config();

const { Client } = pg;

async function cleanupAndResync() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();
  console.log('🔌 Connected to database\n');

  try {
    // Get the event
    const eventQuery = await client.query(
      "SELECT * FROM tablecn_events WHERE LOWER(name) LIKE '%why look at animals%'"
    );

    if (eventQuery.rows.length === 0) {
      console.error('❌ Event not found!');
      return;
    }

    const event = eventQuery.rows[0];
    console.log(`📅 Event: ${event.name}`);
    console.log(`   ID: ${event.id}`);
    console.log(`   Product ID: ${event.woocommerce_product_id}\n`);

    // Count existing attendees
    const countQuery = await client.query(
      'SELECT COUNT(*) FROM tablecn_attendees WHERE event_id = $1',
      [event.id]
    );
    const existingCount = parseInt(countQuery.rows[0].count);
    console.log(`💾 Current attendees: ${existingCount}\n`);

    // Delete all attendees for this event
    const deleteResult = await client.query(
      'DELETE FROM tablecn_attendees WHERE event_id = $1',
      [event.id]
    );
    console.log(`🗑️  Deleted ${deleteResult.rowCount} attendees\n`);

    console.log('✅ Cleanup complete!');
    console.log('\n📋 Next steps:');
    console.log('   1. Go to http://localhost:3000');
    console.log('   2. Select the "Why Look at Animals" event');
    console.log('   3. Click the "Refresh" button to resync from WooCommerce');
    console.log('   4. Then run: pnpm tsx -r dotenv/config src/scripts/validate-tickets.ts');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

cleanupAndResync();