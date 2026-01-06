# Comprehensive Historical Resync Instructions

This guide walks you through the complete process of resyncing ALL historical data from WooCommerce (March 2023 - January 2026) and rebuilding your community members table.

## ⚠️ IMPORTANT: Before You Start

### 1. Backup Your Database

**CRITICAL**: This process will DELETE ALL existing attendee and member data. You MUST backup your database first.

**How to backup on Neon:**
1. Go to https://console.neon.tech/
2. Select your project
3. Go to "Backups" tab
4. Click "Create backup" or note your latest automatic backup timestamp

### 2. Verify Prerequisites

Make sure you have:
- ✅ `DATABASE_URL` in your `.env` file
- ✅ `WOOCOMMERCE_URL` in your `.env` file
- ✅ `WOOCOMMERCE_CONSUMER_KEY` in your `.env` file
- ✅ `WOOCOMMERCE_CONSUMER_SECRET` in your `.env` file
- ✅ Node.js installed
- ✅ All npm dependencies installed (`pnpm install`)

### 3. Understand What Will Happen

This process will:
1. **DELETE** all existing attendee data
2. **RESYNC** all events from March 2023 - January 2026
3. **AUTO CHECK-IN** all attendees for past events (before Jan 5, 2026)
4. **FETCH** both booker AND ticket holder information separately
5. **DELETE** all existing community member data
6. **REBUILD** community members from the new attendee data
7. **CALCULATE** accurate attendance counts and active member status

**Estimated time**: 20-35 minutes total

---

## Step-by-Step Instructions

### Step 1: Full Historical Resync

This script will delete all attendee data and resync from WooCommerce.

```bash
node full-historical-resync.mjs
```

**What it does:**
- Truncates the `tablecn_attendees` table (deletes all data)
- Fetches ALL events with WooCommerce product IDs
- For each event:
  - Uses extended date window (6 months before event)
  - Fetches all orders from WooCommerce
  - Extracts individual tickets with separate booker/ticket holder info
  - Marks past events (before Jan 5, 2026) as checked in
  - Inserts attendee records into database
- Adds 500ms delay between events (rate limiting)

**Expected output:**
```
🔌 Connected to database

⚠️  WARNING: This will DELETE ALL existing attendee data!
Press Ctrl+C within 5 seconds to cancel...

🗑️  Truncating tablecn_attendees table...
✓ Attendees table cleared

Found X events to sync

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 [1/X] Event Name
   Date: 2023-03-15
   Product ID: 12345
   Auto check-in: YES (past event)
   Fetching orders for product 12345...
   Found Y orders
   ✓ Processed Z tickets (Z created)
...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Resync complete!
   Events processed: X/X
   Tickets processed: Y
   Tickets created: Y
   Errors: 0

📋 Next steps:
   1. Run: node rebuild-members.mjs
   2. Run: node verify-resync.mjs
```

**How long?** ~15-30 minutes (depends on number of events and WooCommerce API speed)

**If you see errors:**
- Check your WooCommerce API credentials
- Check your database connection
- Look for specific error messages
- The script will continue processing other events even if one fails

---

### Step 2: Rebuild Community Members

This script will delete all member data and rebuild from attendee data.

```bash
node rebuild-members.mjs
```

**What it does:**
- Truncates the `tablecn_members` table (deletes all data)
- Gets all unique ticket holder emails from attendees
- For each unique email:
  - Creates member record with ticket holder info (not booker)
  - Counts total checked-in events (excluding social events)
  - Calculates last event date
  - Determines active status (3+ events total, 1+ in last 9 months)
  - Sets membership expiration (9 months from last event)

**Expected output:**
```
🔌 Connected to database

⚠️  WARNING: This will DELETE ALL existing member data!
Press Ctrl+C within 5 seconds to cancel...

🗑️  Truncating tablecn_members table...
✓ Members table cleared

📧 Fetching unique attendee emails...
Found X unique emails

Processing member 50/X...
Processing member 100/X...
...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Members rebuild complete!
   Total members created: X
   Active members: Y
   Inactive members: Z

📋 Next step:
   Run: node verify-resync.mjs
```

**How long?** ~2-5 minutes

**Social events excluded:**
Events with these keywords are NOT counted toward attendance:
- walk
- party
- drinks
- social

**Active member criteria:**
- 3+ total events attended (non-social)
- AND 1+ event in last 9 months

---

### Step 3: Verify Results

This script validates the resync and provides statistics.

```bash
node verify-resync.mjs
```

**What it does:**
- Checks total events synced
- Checks total attendees created
- Validates past events check-in rate (should be 100%)
- Validates future events check-in rate (should be 0%)
- Shows community member statistics
- Displays multi-ticket order examples
- Verifies booker vs ticket holder separation

**Expected output:**
```
🔌 Connected to database

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 RESYNC VERIFICATION REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📅 Events:
   Total events with WooCommerce IDs: X

👥 Attendees:
   Total attendees: Y
   Events with attendees: X
   Average per event: 25.3
   Max per event: 120
   Min per event: 5

✅ Past Events Check-in (before Jan 5, 2026):
   Total past attendees: Y
   Checked in: Y
   Check-in rate: 100.0% (should be 100%)

📅 Future Events Check-in (Jan 5, 2026+):
   Total future attendees: Z
   Checked in: 0
   Check-in rate: 0.0% (should be 0%)

🏘️  Community Members:
   Total members: A
   Active members: B
   Inactive members: C

   Active member attendance distribution (top 10):
     15 events: 5 members
     12 events: 8 members
     10 events: 12 members
     ...

🎫 Multi-Ticket Orders (different names):
   Total multi-ticket orders: X

   Sample multi-ticket orders:
   1. Order 17713:
      Tickets: 2
      Names: sian williams, Michael Merwitzer
      Emails: sian@example.com, michael@example.com
   ...

📋 Booker vs Ticket Holder Separation:
   Total attendees with booker info: Y
   Different email (ticket ≠ booker): Z (X%)
   Different name (ticket ≠ booker): W (Y%)

⚠️  Events Without Attendees:
   ✓ All events have attendees!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Verification complete!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**How long?** <1 minute

**What to check:**
- ✅ Past events check-in rate = 100%
- ✅ Future events check-in rate = 0%
- ✅ Multi-ticket orders show different names (e.g., Order 17713)
- ✅ Booker vs ticket holder emails are different for some orders
- ✅ Active member counts look reasonable

---

## Troubleshooting

### Script hangs or takes too long
- WooCommerce API might be slow or throttling
- Check your internet connection
- The script has 500ms delays between events (normal)

### "No orders found" for many events
- Check your WooCommerce API credentials
- Verify the extended date window is working
- Some old events might genuinely have no orders

### Past events check-in rate is not 100%
- Check the cutoff date logic in `full-historical-resync.mjs:116`
- Verify event dates are stored correctly in database

### Future events have checked-in attendees
- Check the cutoff date logic
- Verify your system clock is correct

### Members count seems low
- Check that social events are being excluded
- Verify attendance counts are accurate
- Some people might only have 1-2 events (not counted as members)

---

## After Resync

### 1. Clear Browser Cache
```bash
# Clear your browser cache or hard refresh
# Chrome/Firefox: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
```

### 2. Verify Frontend
1. Navigate to http://localhost:3001
2. Check events page - verify attendee lists
3. Check community members page - verify counts
4. Test check-in functionality on a future event

### 3. Spot Check Sample Data
Look at a few specific orders/events:
- **Order 17713** - Should show "sian williams" AND "Michael Merwitzer"
- Check that booker names vs ticket holder names are different where expected
- Verify active member badges show correctly

---

## Rollback Plan

If something goes wrong:

### Option 1: Restore from Backup (Recommended)
1. Go to Neon dashboard
2. Select your backup
3. Restore database to backup state
4. Review error logs
5. Fix any issues in the scripts
6. Try again

### Option 2: Re-run Scripts
If only the members table is wrong:
```bash
# Just rebuild members (keeps attendee data)
node rebuild-members.mjs
node verify-resync.mjs
```

If attendee data is wrong:
```bash
# Full resync (all three steps)
node full-historical-resync.mjs
node rebuild-members.mjs
node verify-resync.mjs
```

---

## Technical Details

### Date Windows
- **Extended window**: 6 months before event to 7 days after
- **Cutoff date**: Jan 5, 2026 23:59 UTC (events before = auto check-in)

### Booker vs Ticket Holder
- **Booker**: From `order.billing` fields (person who placed order)
  - `booker_first_name`, `booker_last_name`, `booker_email`
- **Ticket Holder**: From `_ticket_data` fields (person attending)
  - `first_name`, `last_name`, `email`
- **Community Members**: Created using ticket holder info (NOT booker)

### Social Events
Events with these keywords are excluded from attendance counts:
- walk
- party
- drinks
- social

### Active Member Criteria
```
is_active_member = (total_events_attended >= 3) AND (events_in_last_9_months >= 1)
```

### Membership Expiration
```
membership_expires_at = last_event_date + 9 months
```

---

## Quick Reference

```bash
# Full workflow (run in order):
node full-historical-resync.mjs  # ~15-30 min
node rebuild-members.mjs         # ~2-5 min
node verify-resync.mjs           # <1 min

# If only members need fixing:
node rebuild-members.mjs
node verify-resync.mjs

# If you need to check verification again:
node verify-resync.mjs
```

---

## Support

If you encounter issues:
1. Check error messages in console
2. Verify your `.env` file has all credentials
3. Check Neon database is accessible
4. Check WooCommerce API is responding
5. Review the script source code for logic errors

**Remember**: Always backup your database before running these scripts!
