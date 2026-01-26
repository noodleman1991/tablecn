#!/usr/bin/env node

/**
 * Unsubscribe Legacy Contacts Script
 *
 * Reads a CSV exported from Loops.so and sets `subscribed: false` for contacts
 * who have NOT resubscribed (resubscribed !== 1/true).
 *
 * Usage:
 *   node scripts/unsubscribe-legacy-contacts.mjs <csv-file> [--dry-run]
 *
 * Examples:
 *   node scripts/unsubscribe-legacy-contacts.mjs legacy-unsubscribed.csv --dry-run
 *   node scripts/unsubscribe-legacy-contacts.mjs legacy-unsubscribed.csv
 *   node scripts/unsubscribe-legacy-contacts.mjs legacy-non-subscribers.csv
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const LOOPS_API_BASE_URL = 'https://app.loops.so/api/v1';
const RATE_LIMIT_PER_SECOND = 10;
const DELAY_BETWEEN_REQUESTS_MS = Math.ceil(1000 / RATE_LIMIT_PER_SECOND); // ~100ms

// Get API key from environment
const LOOPS_API_KEY = process.env.LOOPS_API_KEY;

if (!LOOPS_API_KEY) {
  console.error('❌ LOOPS_API_KEY environment variable is required');
  console.error('   Run with: LOOPS_API_KEY=your_key node scripts/unsubscribe-legacy-contacts.mjs ...');
  process.exit(1);
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const csvFile = args.find(arg => !arg.startsWith('--'));

if (!csvFile) {
  console.error('❌ CSV file path is required');
  console.error('   Usage: node scripts/unsubscribe-legacy-contacts.mjs <csv-file> [--dry-run]');
  process.exit(1);
}

// Resolve CSV path (relative to project root)
const csvPath = path.resolve(process.cwd(), csvFile);

if (!fs.existsSync(csvPath)) {
  console.error(`❌ CSV file not found: ${csvPath}`);
  process.exit(1);
}

/**
 * Parse CSV file and return array of contact objects
 */
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCSVLine(lines[0]);
  const contacts = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const contact = {};

    headers.forEach((header, index) => {
      contact[header] = values[index] || '';
    });

    contacts.push(contact);
  }

  return contacts;
}

/**
 * Parse a single CSV line, handling quoted values with commas
 */
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

/**
 * Check if a contact has resubscribed
 */
function hasResubscribed(contact) {
  const resubscribed = contact.resubscribed;
  return resubscribed === '1' || resubscribed === 'true' || resubscribed === 'TRUE' || resubscribed === true;
}

/**
 * Check if a contact is already unsubscribed
 */
function isAlreadyUnsubscribed(contact) {
  const subscribed = contact.subscribed;
  return subscribed === 'false' || subscribed === 'FALSE' || subscribed === false;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Update a contact in Loops.so to set subscribed: false
 */
async function unsubscribeContact(email) {
  const response = await fetch(`${LOOPS_API_BASE_URL}/contacts/update`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${LOOPS_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      subscribed: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return await response.json();
}

/**
 * Main function
 */
async function main() {
  console.log('');
  console.log('📧 Loops.so Legacy Contact Unsubscribe Script');
  console.log('============================================');
  console.log(`📁 CSV File: ${csvPath}`);
  console.log(`🔧 Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE (will update contacts)'}`);
  console.log('');

  // Parse CSV
  console.log('📖 Reading CSV file...');
  const contacts = parseCSV(csvPath);
  console.log(`   Found ${contacts.length} contacts`);
  console.log('');

  // Categorize contacts
  const toUpdate = [];
  const skippedResubscribed = [];
  const skippedAlreadyUnsubscribed = [];
  const skippedNoEmail = [];

  for (const contact of contacts) {
    const email = contact.email?.trim();

    if (!email) {
      skippedNoEmail.push(contact);
      continue;
    }

    if (hasResubscribed(contact)) {
      skippedResubscribed.push(contact);
      continue;
    }

    if (isAlreadyUnsubscribed(contact)) {
      skippedAlreadyUnsubscribed.push(contact);
      continue;
    }

    toUpdate.push(contact);
  }

  console.log('📊 Analysis:');
  console.log(`   ✅ To unsubscribe: ${toUpdate.length}`);
  console.log(`   ⏭️  Skipped (resubscribed): ${skippedResubscribed.length}`);
  console.log(`   ⏭️  Skipped (already unsubscribed): ${skippedAlreadyUnsubscribed.length}`);
  console.log(`   ⏭️  Skipped (no email): ${skippedNoEmail.length}`);
  console.log('');

  if (skippedResubscribed.length > 0) {
    console.log('📋 Resubscribed contacts (will keep subscribed):');
    skippedResubscribed.forEach(c => console.log(`   - ${c.email}`));
    console.log('');
  }

  if (toUpdate.length === 0) {
    console.log('✨ No contacts to update. All done!');
    return;
  }

  if (dryRun) {
    console.log('🔍 DRY RUN - Would unsubscribe these contacts:');
    toUpdate.forEach(c => console.log(`   - ${c.email}`));
    console.log('');
    console.log('💡 Run without --dry-run to actually update contacts');
    return;
  }

  // Actually update contacts
  console.log('🚀 Starting updates...');
  console.log(`   Rate limit: ${RATE_LIMIT_PER_SECOND} requests/second`);
  console.log('');

  let successCount = 0;
  let errorCount = 0;
  const errors = [];

  for (let i = 0; i < toUpdate.length; i++) {
    const contact = toUpdate[i];
    const email = contact.email.trim();

    try {
      await unsubscribeContact(email);
      successCount++;

      // Progress logging every 10 contacts
      if ((i + 1) % 10 === 0 || i === toUpdate.length - 1) {
        console.log(`   Progress: ${i + 1}/${toUpdate.length} (${successCount} success, ${errorCount} errors)`);
      }
    } catch (error) {
      errorCount++;
      errors.push({ email, error: error.message });
      console.log(`   ❌ Error for ${email}: ${error.message}`);
    }

    // Rate limiting - wait between requests
    if (i < toUpdate.length - 1) {
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
    }
  }

  console.log('');
  console.log('📊 Results:');
  console.log(`   ✅ Successfully unsubscribed: ${successCount}`);
  console.log(`   ❌ Errors: ${errorCount}`);
  console.log(`   ⏭️  Skipped (resubscribed): ${skippedResubscribed.length}`);
  console.log(`   ⏭️  Skipped (already unsubscribed): ${skippedAlreadyUnsubscribed.length}`);
  console.log('');

  if (errors.length > 0) {
    console.log('❌ Errors:');
    errors.forEach(e => console.log(`   - ${e.email}: ${e.error}`));
    console.log('');
  }

  console.log('✨ Done!');
}

// Run
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
