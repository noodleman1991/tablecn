# Complete Historical Resync Guide (2023-2026)

This guide walks you through the complete process of discovering all historical events from WooCommerce and syncing all attendee data.

## Overview

The process has these steps:
1. **Discover Events** - Find all WooCommerce products (events) from 2023 onwards
2. **Database Migration** - Add unique constraint to prevent duplicates
3. **Clean Duplicates** - Remove any existing duplicate tickets
4. **Resync Attendees** - Fetch all ticket holders for all events
5. **Rebuild Members** - Recalculate community membership status
6. **Verify** - Check everything worked correctly

**Total Time**: ~45-60 minutes

---

## Prerequisites

### 1. Backup Database ⚠️ CRITICAL
Go to https://console.neon.tech/ and create a backup of your database before proceeding.

### 2. Verify Environment Variables
Check your `.env` file has:
```env
DATABASE_URL=your_neon_database_url
WOOCOMMERCE_URL=your_woocommerce_store_url
WOOCOMMERCE_CONSUMER_KEY=ck_xxxxx
WOOCOMMERCE_CONSUMER_SECRET=cs_xxxxx
```

---

## Step 1: Discover Historical Events

**What it does**: Fetches all products from WooCommerce (2023 onwards) and creates event records in your database with accurate dates.

**IMPORTANT**: The script now correctly parses event dates from WooCommerce's `event_date` metadata field (YYYYMMDD format). This ensures all events have accurate dates matching the actual event information.

### Run the script:
```bash
node discover-historical-events.mjs
```

### What to expect:
```
🔌 Connected to database

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 DISCOVER HISTORICAL EVENTS FROM WOOCOMMERCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 Fetching products from WooCommerce...
   Date filter: After 2023-01-01

   Fetching page 1...
   Fetching page 2...
   Found 150 total products

🎯 Filtering event products...
   Found 120 event products

📝 Processing events...
   ✓ Created: New Possibilities in Science - Jan 15, 2023
   ✓ Created: Philosophy Workshop - Feb 20, 2023
   ...
   Processing 100/120...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Event discovery complete!
   Events created: 115
   Events updated: 3
   Events skipped (already exist): 2
   Total processed: 120
```

**Time**: ~2-5 minutes

### How date extraction works:

The script uses a three-tier approach:
1. **PRIMARY**: Parse `event_date` metadata in YYYYMMDD format (e.g., "20260109" = Jan 9, 2026) - This is the most accurate source
2. **FALLBACK 1**: Extract dates from product names (e.g., "Event - Jan 15, 2023")
3. **FALLBACK 2**: Use product creation date (will show warning)

Events using the primary source (event_date metadata) will have 100% accurate dates. If you see warnings during the script run, those events may need manual date correction.

---

## Step 2: Database Migration

**What it does**: Adds a unique constraint to prevent duplicate tickets in the future.

### Run the migration:
```bash
pnpm db:generate
```

### Answer the prompts:

**For table renames** (select the rename option matching `shadcn_*` → `tablecn_*`):
- `tablecn_attendees`: Select `~ shadcn_attendees › tablecn_attendees`
- `tablecn_email_logs`: Select `~ shadcn_email_logs › tablecn_email_logs`
- `tablecn_events`: Select `~ shadcn_events › tablecn_events`
- `tablecn_members`: Select `~ shadcn_members › tablecn_members`
- `tablecn_woocommerce_cache`: Select `~ shadcn_woocommerce_cache › tablecn_woocommerce_cache`

**For WooCommerce cache columns** (if asked):
- Select `+ cache_key` (create column)
- Select `+ cache_data` (create column)
- Select `+ cached_at` (create column)
- Select `+ expires_at` (create column)
- Select `+ event_id` (create column)

### Apply the migration:
```bash
pnpm db:push
```

**Expected output**:
```
✓ Migration generated successfully
✓ Applying changes to database...
✓ Changes applied
```

**Time**: ~1 minute

---

## Step 3: Clean Existing Duplicates

**What it does**: Removes any duplicate tickets already in your database (keeps earliest record).

### Run the cleanup:
```bash
node cleanup-duplicates.mjs
```

### What to expect:
```
🔌 Connected to database

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 DUPLICATE TICKET CLEANUP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 1: Finding duplicate tickets...

Found 25 duplicate groups:

   1. Ticket abc123: 2 copies (1 duplicates)
   2. Ticket def456: 2 copies (1 duplicates)
   ...

   Total duplicate records to remove: 42

⚠️  WARNING: This will DELETE duplicate records!
   Only the earliest record for each (ticket_id, event_id) will be kept.
   Press Ctrl+C within 5 seconds to cancel...

🗑️  Removing duplicates...

   Ticket abc123:
     Keeping: John Doe (john@example.com) created 2025-01-01
     Deleting: 1 duplicate(s)
   ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Cleanup complete!
   Duplicate groups found: 25
   Duplicate records removed: 42
   Records kept: 25 (earliest for each group)
```

**Time**: ~30 seconds - 2 minutes

---

## Step 4: Full Historical Resync

**What it does**:
- Deletes ALL attendee data
- Fetches ticket holders for ALL events from WooCommerce
- Auto checks-in past events (before Jan 5, 2026)
- Creates fresh attendee records

### Run the resync:
```bash
node full-historical-resync.mjs
```

### What to expect:
```
🔌 Connected to database

⚠️  WARNING: This will DELETE ALL existing attendee data!
Press Ctrl+C within 5 seconds to cancel...

🗑️  Truncating tablecn_attendees table...
✓ Attendees table cleared

Found 120 events to sync

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 [1/120] New Possibilities in Science with Rupert Sheldrake
   Date: 2023-01-15
   Product ID: 12345
   Auto check-in: YES (past event)
   Fetching orders for product 12345...
   Date window: 2022-07-19 to 2023-01-22
   Product is variable
   Found 3 variations
   Found 15 orders
   ✓ Processed 42 tickets (42 created)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 [2/120] Philosophy Workshop
   Date: 2023-02-20
   ...

[Processing continues for all events]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Resync complete!
   Events processed: 120/120
   Tickets processed: 3,245
   Tickets created: 3,245
   Errors: 0

📋 Next steps:
   1. Run: node rebuild-members.mjs
   2. Run: node verify-resync.mjs
```

**Time**: ~20-30 minutes (depends on number of events and WooCommerce API speed)

### Key Features:
- **6-month date window**: Fetches orders from 180 days before each event
- **Auto check-in**: Past events automatically marked as checked in
- **Duplicate prevention**: Skips tickets that already exist (won't create duplicates)
- **Variable products**: Correctly handles events with multiple ticket types

---

## Step 5: Rebuild Community Members

**What it does**:
- Deletes all member records
- Rebuilds from attendee data
- Calculates attendance counts (excluding social events)
- Determines active/inactive status

### Run the rebuild:
```bash
node rebuild-members.mjs
```

### What to expect:
```
🔌 Connected to database

⚠️  WARNING: This will DELETE ALL existing member data!
Press Ctrl+C within 5 seconds to cancel...

🗑️  Truncating tablecn_members table...
✓ Members table cleared

📧 Fetching unique attendee emails...
Found 1,245 unique emails

Processing member 50/1245...
Processing member 100/1245...
...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Members rebuild complete!
   Total members created: 1,245
   Active members: 287
   Inactive members: 958

📋 Next step:
   Run: node verify-resync.mjs
```

**Time**: ~3-5 minutes

### Member Criteria:
- **Active**: 3+ events attended (non-social) AND 1+ event in last 9 months
- **Inactive**: Less than 3 events OR no events in last 9 months
- **Social events excluded**: Events with "walk", "party", "drinks", "social" in name

---

## Step 6: Verify Results

**What it does**: Validates everything worked correctly and shows statistics.

### Run verification:
```bash
node verify-resync.mjs
```

### What to expect:
```
🔌 Connected to database

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 RESYNC VERIFICATION REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📅 Events:
   Total events with WooCommerce IDs: 120

👥 Attendees:
   Total attendees: 3,245
   Events with attendees: 120
   Average per event: 27.0
   Max per event: 85
   Min per event: 5

✅ Past Events Check-in (before Jan 5, 2026):
   Total past attendees: 3,100
   Checked in: 3,100
   Check-in rate: 100.0% (should be 100%)

📅 Future Events Check-in (Jan 5, 2026+):
   Total future attendees: 145
   Checked in: 0
   Check-in rate: 0.0% (should be 0%)

🏘️  Community Members:
   Total members: 1,245
   Active members: 287
   Inactive members: 958

   Active member attendance distribution (top 10):
     15 events: 5 members
     12 events: 8 members
     10 events: 12 members
     ...

🔍 Duplicate Ticket Check:
   ✓ No duplicate tickets found!

🎫 Multi-Ticket Orders (different names):
   Total multi-ticket orders: 234

   Sample multi-ticket orders:
   1. Order 17713:
      Tickets: 2
      Names: sian williams, Michael Merwitzer
      Emails: sian@example.com, michael@example.com
   ...

📋 Booker vs Ticket Holder Separation:
   Total attendees with booker info: 3,245
   Different email (ticket ≠ booker): 523 (16.1%)
   Different name (ticket ≠ booker): 687 (21.2%)

⚠️  Events Without Attendees:
   ✓ All events have attendees!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Verification complete!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Time**: <1 minute

### What to Check:
- ✅ Past events check-in rate = 100%
- ✅ Future events check-in rate = 0%
- ✅ No duplicate tickets
- ✅ "New Possibilities in Science" shows ~42 tickets (not 84!)
- ✅ Multi-ticket orders show different names
- ✅ All events have attendees

---

## Complete Command Sequence

Here's the full sequence to copy/paste (run one at a time):

```bash
# Step 1: Discover events from WooCommerce
node discover-historical-events.mjs

# Step 2: Generate and apply database migration
pnpm db:generate
pnpm db:push

# Step 3: Clean existing duplicates
node cleanup-duplicates.mjs

# Step 4: Resync all attendees
node full-historical-resync.mjs

# Step 5: Rebuild community members
node rebuild-members.mjs

# Step 6: Verify everything
node verify-resync.mjs
```

---

## Troubleshooting

### "No products found"
- Check your WooCommerce API credentials
- Verify your store has products from 2023 onwards
- Check WooCommerce API rate limits

### "Only found 2025 events"
- The discover script filters products after 2023-01-01
- Check if your older products are published (not draft/private)

### "Duplicate tickets still showing"
- The database migration might not have applied
- Re-run `pnpm db:push`
- Check if constraint was added: Look for `unique_ticket_per_event` in schema

### "Past events not checked in"
- Check the date cutoff in full-historical-resync.mjs:116
- Should be: `new Date('2026-01-05T23:59:59Z')`

### "Script times out"
- WooCommerce API might be rate limiting
- Increase delays in the script (change 500ms to 1000ms)
- Run during off-peak hours

---

## Post-Resync Actions

### 1. Check Frontend
```bash
# Start dev server if not running
pnpm run dev

# Navigate to http://localhost:3001
```

### 2. Verify Sample Events
- Check "New Possibilities in Science" has ~42 tickets
- Verify dates look correct
- Check community members page

### 3. Test Check-in
- Try checking someone in on a future event
- Verify it updates correctly

---

## Rollback

If something goes wrong:

### Option 1: Restore from Backup
1. Go to Neon dashboard
2. Restore from the backup you created
3. Fix any issues
4. Try again

### Option 2: Re-run from Step 4
If events are correct but attendees are wrong:
```bash
node full-historical-resync.mjs
node rebuild-members.mjs
node verify-resync.mjs
```

---

## Expected Final Results

After completing all steps:
- **120+ events** from 2023-2026 in database
- **3,000+ attendees** with correct check-in status
- **1,200+ community members** with accurate counts
- **No duplicates** in the system
- **Past events** = 100% checked in
- **Future events** = 0% checked in
- **Multi-ticket orders** show different attendee names

---

## Questions?

If you encounter issues:
1. Check the error messages in console output
2. Verify your environment variables are correct
3. Check database is accessible
4. Review the verification output for specific issues
