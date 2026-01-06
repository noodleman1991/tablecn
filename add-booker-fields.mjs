// Add booker fields to attendees table
import pg from 'pg';
import 'dotenv/config';

const { Client } = pg;

async function addBookerFields() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();
  console.log('🔌 Connected to database\n');

  try {
    console.log('Adding booker fields to tablecn_attendees table...\n');

    // Add booker_first_name column
    await client.query(`
      ALTER TABLE tablecn_attendees
      ADD COLUMN IF NOT EXISTS booker_first_name VARCHAR(128);
    `);
    console.log('✓ Added booker_first_name column');

    // Add booker_last_name column
    await client.query(`
      ALTER TABLE tablecn_attendees
      ADD COLUMN IF NOT EXISTS booker_last_name VARCHAR(128);
    `);
    console.log('✓ Added booker_last_name column');

    // Add booker_email column
    await client.query(`
      ALTER TABLE tablecn_attendees
      ADD COLUMN IF NOT EXISTS booker_email VARCHAR(255);
    `);
    console.log('✓ Added booker_email column');

    console.log('\n✅ Migration complete!');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

addBookerFields();
