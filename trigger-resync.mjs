// Trigger resync via the running dev server's API
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const dotenv = require('dotenv');
dotenv.config();

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function triggerResync() {
  const eventId = 'qAPiQga9y774'; // "Why Look at Animals" event

  console.log('🔄 Triggering resync for event:', eventId);
  console.log('   Using dev server at http://localhost:3001\n');

  try {
    // Call the refresh action
    const response = await fetch('http://localhost:3001/api/refresh-attendees', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ eventId }),
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ Resync successful!');
      console.log(data);
    } else {
      console.log('❌ Resync failed with status:', response.status);
      console.log(await response.text());
    }
  } catch (error) {
    console.error('❌ Error triggering resync:', error.message);
    console.log('\n📋 Manual resync required:');
    console.log('   1. Go to http://localhost:3001');
    console.log('   2. Select the "Why Look at Animals" event');
    console.log('   3. Click the "Refresh" button');
  }
}

triggerResync();
