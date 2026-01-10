// Run migration script without psql command
import { createRequire } from 'module';
import pg from 'pg';
import fs from 'fs';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const { Client } = pg;

async function runMigration() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('🔌 Connected to database\n');

    // Read migration file
    const migrationSQL = fs.readFileSync('src/db/migrations/0003_add_order_date.sql', 'utf8');

    // Split by semicolons and run each statement
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      console.log('Running:', statement.substring(0, 50) + '...');
      await client.query(statement);
      console.log('✓ Success\n');
    }

    console.log('✅ Migration complete!');

    // Verify the column was added
    console.log('\n📋 Verifying column...');
    const result = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'tablecn_attendees'
        AND column_name = 'woocommerce_order_date'
    `);

    if (result.rows.length > 0) {
      console.log('✓ Column exists:', result.rows[0]);
    } else {
      console.log('✗ Column not found - migration may have failed');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

runMigration();
