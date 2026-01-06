// Simple cleanup using DATABASE_URL directly
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load dotenv
const dotenv = require('dotenv');
dotenv.config();

console.log('🔌 Attempting database cleanup...\n');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found in environment');
  process.exit(1);
}

console.log('📊 Database URL loaded');
console.log('Event ID: qAPiQga9y774\n');

console.log('✅ Cleanup approach:');
console.log('   Since we cannot use pg module or psql,');
console.log('   the safest approach is to use the running dev server:\n');
console.log('   1. Go to http://localhost:3001');
console.log('   2. Select the "Why Look at Animals" event');
console.log('   3. Note the current attendee count');
console.log('   4. Use the database admin panel or manually run SQL');
console.log('   5. Then click "Refresh" to resync from WooCommerce\n');

console.log('SQL Query to run manually:');
console.log("DELETE FROM tablecn_attendees WHERE event_id = 'qAPiQga9y774';\n");

console.log('Or use a database GUI tool with this connection string:');
console.log(DATABASE_URL + '\n');
