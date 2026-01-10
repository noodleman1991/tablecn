# Complete Historical Resync Guide

## Overview

This guide will walk you through running a complete historical data resync to populate your database with all WooCommerce ticket data, including early bird purchases that were previously excluded.

**Expected Outcome:**
- Total attendees: ~2.5-3x increase (from ~1,345 to ~3,500-4,000)
- Village of Lovers example: 23/23 tickets (was 9/23)
- Events with zero attendees: <20 (was 127)
- All order purchase dates recorded

**Time Required:** 4-7 hours (script runs automatically, can be resumed if interrupted)

---

## Prerequisites

✅ All code fixes have been applied:
- Duplicate prevention fixed in sync scripts
- Network retry logic added
- Date filtering removed
- UI column visibility fixed

⚠️ **Important:** No backup is created (per your preference). The sync will add new records but NOT delete existing ones.

---

## Step 1: Run Database Migration (2 minutes)

**What it does:** Adds `woocommerce_order_date` column to store actual purchase dates.

### Command:

```bash
DATABASE_URL='postgresql://neondb_owner:npg_sN5tMdouFOa6@ep-tiny-mode-a941wkv7-pooler.gwc.azure.neon.tech/neondb?sslmode=require' psql -f src/db/migrations/0003_add_order_date.sql
```

###Expected Output:

```
ALTER TABLE
CREATE INDEX
COMMENT
```

### Verification:

```bash
DATABASE_URL='postgresql://neondb_owner:npg_sN5tMdouFOa6@ep-tiny-mode-a941wkv7-pooler.gwc.azure.neon.tech/neondb?sslmode=require' psql -c "
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'tablecn_attendees'
  AND column_name = 'woocommerce_order_date';
"
```

**Should return:**
```
     column_name      |      data_type
----------------------+----------------------------
 woocommerce_order_date | timestamp without time zone
```

✅ **Done!** Proceed to Step 2.

---

## Step 2: Clean Existing Duplicates (10-30 minutes)

**What it does:** Removes any duplicate tickets that may exist from previous syncs.

### Command:

```bash
node cleanup-duplicates.mjs
```

### Expected Output:

**Best case (no duplicates):**
```
🔍 Scanning for duplicate tickets...
Found 0 duplicate groups

✅ No duplicates found!
```

**If duplicates exist:**
```
🔍 Scanning for duplicate tickets...
Found 3 duplicate groups

Group 1: ticket_id = "abc123", event_id = "xyz789"
  - 2 duplicates found
  - Keeping: id=earliest_created_at (created 2023-11-01)
  - Deleting: 1 duplicate(s)

Group 2: ticket_id = "def456", event_id = "xyz789"
  - 3 duplicates found
  - Keeping: id=earliest_created_at (created 2023-10-15)
  - Deleting: 2 duplicate(s)

✅ Cleaned 3 duplicate tickets
```

### Verification:

```bash
DATABASE_URL='postgresql://neondb_owner:npg_sN5tMdouFOa6@ep-tiny-mode-a941wkv7-pooler.gwc.azure.neon.tech/neondb?sslmode=require' psql -c "
SELECT ticket_id, event_id, COUNT(*) as count
FROM tablecn_attendees
WHERE ticket_id IS NOT NULL AND ticket_id != ''
GROUP BY ticket_id, event_id
HAVING COUNT(*) > 1;
"
```

**Should return:** `(0 rows)`

✅ **Done!** Proceed to Step 3.

---

## Step 3: Run Full Historical Resync (4-7 hours)

**What it does:** Fetches ALL orders from WooCommerce and syncs tickets to database.

### ⚠️ IMPORTANT NOTES:

1. **Script runs for 4-7 hours** - You can close the terminal and it will continue running in the background
2. **Can be interrupted** - Use Ctrl+C to stop, then resume from last event
3. **Safe to run** - Only adds new tickets, doesn't delete existing ones
4. **Network errors handled** - Retries 3 times automatically

### Recommended: Run in Background with Logging

```bash
nohup node resume-resync.mjs 1 > resync-$(date +%Y%m%d-%H%M%S).log 2>&1 &
```

**This command:**
- `nohup` - Keeps running after you close terminal
- `> resync-DATE.log` - Saves output to a log file
- `2>&1` - Captures both success and error messages
- `&` - Runs in background

**To monitor progress:**
```bash
tail -f resync-*.log
```
Press Ctrl+C to stop watching (script keeps running)

### Alternative: Run in Foreground

If you want to watch in real-time:

```bash
node resume-resync.mjs 1
```

### What You'll See:

```
🔌 Connected to database

Found 279 events to sync

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 Village of Lovers
   Date: Tue Nov 21 2023
   Product ID: 4382
   Fetching orders for product 4382...
   Product is simple
   Found 23 orders
   ✓ Processed 23 tickets (14 created, 9 existing)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 Another Event
   Date: Wed Dec 15 2023
   Product ID: 5123
   ⚠️  Network error (attempt 1/3), retrying in 2000ms...
      Error: socket hang up
   Fetching orders for product 5123...
   Found 15 orders
   ✓ Processed 15 tickets (15 created)

[... continues for all 279 events ...]

✅ Resync complete!
   Events processed: 279
   Tickets processed: 3,847
   Tickets created: 2,502 new
   Tickets skipped: 1,345 existing
```

### If Interrupted:

Find the last successful event ID in the log, then resume:

```bash
# Find last successful event
grep "📅" resync-*.log | tail -5

# Resume from event 150 (example)
node resume-resync.mjs 150
```

### Troubleshooting:

**Error: "socket hang up" or "ENOTFOUND"**
- Normal! Script retries 3 times automatically
- If all 3 retries fail, note the event ID and continue
- Manually resync failed events later

**Error: "UNIQUE constraint violation"**
- Means ticket already exists (duplicate check failed somehow)
- Safe to ignore - existing ticket is kept
- Should be rare with fixed duplicate logic

**Script seems stuck:**
- Check log file: `tail -f resync-*.log`
- Some events have many tickets (100+) and take several minutes
- Network calls to WooCommerce API can be slow

✅ **Done!** Proceed to Step 4.

---

## Step 4: Verify Data Completeness (5 minutes)

Run these queries to confirm the resync worked correctly.

### A. Check Total Attendees

```bash
DATABASE_URL='postgresql://neondb_owner:npg_sN5tMdouFOa6@ep-tiny-mode-a941wkv7-pooler.gwc.azure.neon.tech/neondb?sslmode=require' psql -c "
SELECT COUNT(*) as total_attendees
FROM tablecn_attendees;
"
```

**Expected:** ~3,500-4,000 (was ~1,345)

### B. Check Village of Lovers (Test Case)

```bash
DATABASE_URL='postgresql://neondb_owner:npg_sN5tMdouFOa6@ep-tiny-mode-a941wkv7-pooler.gwc.azure.neon.tech/neondb?sslmode=require' psql -c "
SELECT COUNT(*) as village_tickets
FROM tablecn_attendees a
JOIN tablecn_events e ON a.event_id = e.id
WHERE e.woocommerce_product_id = '4382';
"
```

**Expected:** 23 tickets (was 9)

### C. Check Events with Zero Attendees

```bash
DATABASE_URL='postgresql://neondb_owner:npg_sN5tMdouFOa6@ep-tiny-mode-a941wkv7-pooler.gwc.azure.neon.tech/neondb?sslmode=require' psql -c "
SELECT COUNT(*) as zero_attendee_events
FROM (
  SELECT e.id, COUNT(a.id) as attendee_count
  FROM tablecn_events e
  LEFT JOIN tablecn_attendees a ON a.event_id = e.id
  WHERE e.woocommerce_product_id IS NOT NULL
  GROUP BY e.id
) sub
WHERE attendee_count = 0;
"
```

**Expected:** <20 events (was 127)

### D. Check Average Tickets Per Event

```bash
DATABASE_URL='postgresql://neondb_owner:npg_sN5tMdouFOa6@ep-tiny-mode-a941wkv7-pooler.gwc.azure.neon.html/neondb?sslmode=require' psql -c "
SELECT ROUND(AVG(attendee_count), 1) as avg_tickets_per_event
FROM (
  SELECT e.id, COUNT(a.id) as attendee_count
  FROM tablecn_events e
  LEFT JOIN tablecn_attendees a ON a.event_id = e.id
  WHERE e.woocommerce_product_id IS NOT NULL
  GROUP BY e.id
) sub
WHERE attendee_count > 0;
"
```

**Expected:** 15-20 tickets/event (was 8.8)

### E. Check Order Dates Are Populated

```bash
DATABASE_URL='postgresql://neondb_owner:npg_sN5tMdouFOa6@ep-tiny-mode-a941wkv7-pooler.gwc.azure.neon.tech/neondb?sslmode=require' psql -c "
SELECT
  COUNT(*) as total,
  COUNT(woocommerce_order_date) as with_date,
  COUNT(*) - COUNT(woocommerce_order_date) as without_date
FROM tablecn_attendees;
"
```

**Expected:** Most records should have order dates (new records = 100%, old records may be NULL)

### ✅ Success Criteria:

- Total attendees: 2.5-3x increase ✅
- Village of Lovers: 23 tickets ✅
- Zero attendee events: <20 ✅
- Average per event: 15-20 ✅
- Order dates populated: High percentage ✅

If numbers don't match, check the resync log for errors.

---

## Step 5: Rebuild Member Records (30 minutes)

**What it does:** Recalculates member statistics based on updated attendee data.

### Command:

```bash
node rebuild-members.mjs
```

### Expected Output:

```
🔄 Rebuilding member records from attendees...
Processing 2,145 unique emails...
✓ Created/updated 2,145 member records

📊 Summary:
   Active members: 1,234
   Inactive members: 911
   Total events attended: 3,847
   Average events per member: 1.8
```

### Verification:

```bash
DATABASE_URL='postgresql://neondb_owner:npg_sN5tMdouFOa6@ep-tiny-mode-a941wkv7-pooler.gwc.azure.neon.tech/neondb?sslmode=require' psql -c "
SELECT
  (SELECT COUNT(DISTINCT email) FROM tablecn_attendees) as unique_attendee_emails,
  (SELECT COUNT(*) FROM tablecn_members) as total_members;
"
```

**Should be close** (members might have a few extra from manual additions)

✅ **Done!** Proceed to Step 6.

---

## Step 6: Test UI with Real Data (5 minutes)

### Start Development Server:

```bash
pnpm run dev
```

### Test Column Visibility:

1. Navigate to `http://localhost:3000/community-members-list`
2. **Test Responsive Hiding (Scroll OFF):**
   - Resize browser window
   - Verify columns hide/show based on screen size:
     - Mobile (<768px): Only essential columns
     - Tablet (≥768px): + Events Attended
     - Desktop (≥1024px): + Last Event, Membership Expires
3. **Test Horizontal Scroll (Scroll ON):**
   - Click "Scroll Off" button (changes to "Scroll On")
   - Resize window to small size
   - Verify ALL columns stay visible
   - Verify table scrolls horizontally
4. **Test Column Toggle:**
   - Click "View Options" (settings icon)
   - Toggle columns on/off
   - Verify they show/hide correctly
   - With scroll ON, all columns should be accessible

### Expected Behavior:

**Scroll OFF (default):**
- Mobile: Only Name, Email, Status visible
- Tablet+: More columns progressively shown
- Good for mobile UX

**Scroll ON:**
- All columns visible regardless of screen size
- Horizontal scroll active
- User has full control via column toggle
- Good for power users who want to see everything

✅ **Done!** All steps complete.

---

## Quick Reference: All Commands

```bash
# Step 1: Migration
DATABASE_URL='postgresql://neondb_owner:npg_sN5tMdouFOa6@ep-tiny-mode-a941wkv7-pooler.gwc.azure.neon.tech/neondb?sslmode=require' psql -f src/db/migrations/0003_add_order_date.sql

# Step 2: Cleanup
node cleanup-duplicates.mjs

# Step 3: Resync (background with logging)
nohup node resume-resync.mjs 1 > resync-$(date +%Y%m%d-%H%M%S).log 2>&1 &

# Monitor progress
tail -f resync-*.log

# Step 4: Verify (run all queries above)

# Step 5: Rebuild members
node rebuild-members.mjs

# Step 6: Test UI
pnpm run dev
```

---

## Troubleshooting

### Problem: Migration says "column already exists"

**Solution:** Migration already ran! Skip to Step 2.

### Problem: Resync creates duplicates

**Solution:**
1. Stop resync (Ctrl+C)
2. Run `node cleanup-duplicates.mjs`
3. Check duplicate prevention fixes are applied
4. Resume resync

### Problem: Network errors persist after 3 retries

**Solution:**
1. Note the failing event IDs from log
2. Let script continue with other events
3. Manually resync failed events later:
   ```bash
   node resume-resync.mjs [failed_event_id]
   ```

### Problem: Verification queries show wrong numbers

**Solution:**
1. Check resync log for errors: `grep "✗" resync-*.log`
2. Count how many events failed: `grep "✗" resync-*.log | wc -l`
3. Review specific failures and retry those events

### Problem: UI columns still not showing

**Solution:**
1. Hard refresh browser (Ctrl+Shift+R)
2. Clear browser cache
3. Check browser console for errors
4. Verify TypeScript build: `npx tsc --noEmit`

---

## Summary

**What Was Fixed:**
✅ Duplicate prevention logic (checks both ticket_id AND event_id)
✅ Date filtering removed (captures all early bird tickets)
✅ Network retry logic (handles transient errors)
✅ Order date storage (tracks actual purchase dates)
✅ UI column visibility (responsive + horizontal scroll)

**Expected Results:**
✅ 2.5-3x more attendee records
✅ Complete historical data (no missing early birds)
✅ Better UX for viewing member data
✅ Production-ready sync process

**Time Investment:**
- Migration: 2 min
- Cleanup: 10-30 min
- Resync: 4-7 hours (automatic)
- Rebuild: 30 min
- Verification: 5 min
- Testing: 5 min

**Total active time:** ~1 hour (plus 4-7 hours automated processing)

---

## Next Steps After Completion

1. **Monitor Production:**
   - Watch for any duplicate tickets appearing
   - Check resync logs periodically
   - Verify member counts stay consistent

2. **Future Syncs:**
   - Use `node resume-resync.mjs 1` for full resyncs
   - Or sync individual events as needed
   - All fixes are now in place for reliable syncing

3. **Optional Improvements:**
   - Add ON CONFLICT clauses for extra safety
   - Create automated verification script
   - Document sync process for team

---

**Questions?** Check the detailed plan file at `.claude/plans/floating-fluttering-rossum.md`
