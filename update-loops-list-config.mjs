#!/usr/bin/env node
/**
 * Update Loops.so List Configuration
 *
 * Run this after you rename your list in Loops.so dashboard
 * It will fetch the new list ID and help you update your .env file
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const LOOPS_API_KEY = process.env.LOOPS_API_KEY;

console.log('🔍 Fetching Loops.so mailing lists...\n');

try {
  const response = await fetch('https://app.loops.so/api/v1/lists', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${LOOPS_API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const lists = await response.json();

  console.log(`Found ${lists.length} mailing list(s):\n`);

  lists.forEach((list, index) => {
    console.log(`${index + 1}. ${list.name}`);
    console.log(`   ID: ${list.id}`);
    console.log(`   Public: ${list.isPublic ? 'Yes' : 'No'}`);
    console.log('');
  });

  // Find "Active Community Members" list (correct spelling)
  const activeList = lists.find(l =>
    l.name === 'Active Community Members'
  );

  if (activeList) {
    console.log('✅ Found "Active Community Members" list!');
    console.log(`   List ID: ${activeList.id}`);
    console.log('\n📝 Update your .env file with:');
    console.log(`LOOPS_ACTIVE_MEMBERS_LIST_ID="${activeList.id}"`);

    if (process.env.LOOPS_ACTIVE_MEMBERS_LIST_ID !== activeList.id) {
      console.log('\n⚠️  Your current .env has a different ID:');
      console.log(`   Current: ${process.env.LOOPS_ACTIVE_MEMBERS_LIST_ID}`);
      console.log(`   New:     ${activeList.id}`);
      console.log('\n🔧 Please update your .env file manually.');
    } else {
      console.log('\n✅ Your .env is already up to date!');
    }
  } else {
    console.log('⚠️  Could not find "Active Community Members" list');
    console.log('\nPlease:');
    console.log('1. Rename your list in Loops.so dashboard to: "Active Community Members"');
    console.log('2. Run this script again');
  }

} catch (error) {
  console.error('❌ Error:', error.message);
}
