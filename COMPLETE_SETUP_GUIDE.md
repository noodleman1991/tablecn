# Complete Setup Guide - Final Steps

## Current Status

✅ **Resync Running:** Event 209/279 (75% complete, ~5 min remaining)
✅ **Loops Integration:** Code updated and tested
✅ **Database:** Migration complete

---

## 1. Monitor Resync Progress

**Simple command to check progress:**

```bash
# This will show you the latest checkpoint
# The resync outputs progress every 10 events
# Look for lines like: "💾 Progress checkpoint: Event 200/279"
```

Or just watch your terminal where you started it! The script outputs live progress.

**Current progress visible in terminal:** Event 209/279

---

## 2. Fix List Name in Loops.so Dashboard

Your list is currently named: **"Active Community Memebrs"** (typo)

### Steps to Rename:

1. Go to https://app.loops.so
2. Navigate to **Settings** → **Lists** (or **Audience** → **Mailing Lists**)
3. Find "Active Community Memebrs"
4. Click to edit
5. Change name to: **"Active Community Members"** (correct spelling)
6. Save

### After Renaming:

Run this command to verify and update your config:

```bash
node update-loops-list-config.mjs
```

This will:
- Fetch all your lists from Loops.so
- Find "Active Community Members"
- Tell you if you need to update `.env`

If the ID changed (unlikely but possible), you'll need to update this line in `.env`:
```bash
LOOPS_ACTIVE_MEMBERS_LIST_ID="<new_id_here>"
```

---

## 3. After Resync Completes

### Step 1: Rebuild Member Records

```bash
node rebuild-members.mjs
```

This recalculates all membership statuses based on attendance data.

### Step 2: Verify Resync

```bash
node verify-resync.mjs
```

This checks that all events and attendees synced correctly.

### Step 3: Bulk Sync to Loops.so

```bash
node bulk-sync-to-loops.mjs
```

This will:
- Add all 106 active members to "Active Community Members" list
- Remove all 1,092 inactive members from the list
- Show progress every 10 members
- Complete in ~20-30 seconds (respects 10 req/sec rate limit)

**Example output:**
```
🚀 Bulk Sync to Loops.so
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Connected to database

Found 1198 total members:
  • 106 active (will be added to list)
  • 1092 inactive (will be removed from list)

📤 Syncing active members to list...
   Progress: 10/106
   Progress: 20/106
   ...
✓ Synced 106 active members

📥 Removing inactive members from list...
   Progress: 10/1092
   Progress: 20/1092
   ...
✓ Removed 1092 inactive members

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Bulk sync complete!

📊 Summary:
   • Active members synced: 106/106
   • Inactive members removed: 1092/1092
   • Errors: 0
   • Duration: 23.4s
```

---

## 4. Complete Workflow Summary

```bash
# 1. Wait for resync to finish (currently running)
# You'll see: "✅ Resync complete!"

# 2. Rebuild member records
node rebuild-members.mjs

# 3. Verify everything synced correctly
node verify-resync.mjs

# 4. Rename list in Loops.so dashboard
# → Go to https://app.loops.so/settings/lists
# → Rename "Active Community Memebrs" to "Active Community Members"

# 5. Verify config (optional but recommended)
node update-loops-list-config.mjs

# 6. Bulk sync to Loops.so
node bulk-sync-to-loops.mjs

# 7. Check Loops.so dashboard
# → https://app.loops.so/audience
# → Verify "Active Community Members" list has 106 contacts
```

---

## 5. How Ongoing Sync Works (Automatic)

After bulk sync, the system maintains your list automatically:

### Real-time Updates:

✅ **Someone attends their 3rd event:**
- System detects they're now active (3+ total, 1+ recent)
- Automatically added to "Active Community Members" list

✅ **Someone's membership expires (9 months pass):**
- System detects they're now inactive (0 recent events)
- Automatically removed from "Active Community Members" list

✅ **You manually add a member:**
- Immediately added to "Active Community Members" list

✅ **You update member details:**
- If active, synced to Loops with updated info

✅ **You delete a member:**
- Removed from "Active Community Members" list first

### What Gets Synced:

Every contact in your list will have:
- `email`
- `firstName`
- `lastName`
- `totalEventsAttended` (number)
- `lastEventDate` (date)
- `membershipExpiresAt` (date)
- `manuallyAdded` (true/false)
- `source: "community_member"`
- `mailingLists: { "cmk4d1l3r00li0iz92h08a1da": true }`

---

## 6. Monitoring & Troubleshooting

### Check Sync Logs

All operations are logged to the database:

```bash
# View recent sync activity
DATABASE_URL='<your_db_url>' node -e "
import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const result = await client.query(\`
  SELECT operation, status, COUNT(*) as count
  FROM tablecn_loops_sync_log
  GROUP BY operation, status
  ORDER BY operation, status
\`);
console.table(result.rows);
await client.end();
"
```

### Check for Errors

```bash
# View recent failures
DATABASE_URL='<your_db_url>' node -e "
import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const result = await client.query(\`
  SELECT email, operation, error_message, synced_at
  FROM tablecn_loops_sync_log
  WHERE status = 'failed'
  ORDER BY synced_at DESC
  LIMIT 10
\`);
console.table(result.rows);
await client.end();
"
```

### Verify List in Loops.so

1. Go to https://app.loops.so/audience
2. Click "Active Community Members" list
3. Should see ~106 contacts
4. Filter/search to verify specific members

---

## 7. Creating Email Campaigns

Once your list is populated:

### Example Campaign 1: Welcome New Members

**Trigger:** When contact is added to "Active Community Members"

**Email:** "Welcome to Kairos Community! Here's what you can expect..."

### Example Campaign 2: Membership Expiring Soon

**Filter:** `membershipExpiresAt` is within 30 days

**Email:** "Your membership expires soon! Here's how to stay active..."

### Example Campaign 3: Weekly Newsletter

**Audience:** "Active Community Members" list

**Schedule:** Every Monday

---

## Scripts Reference

| Script | Purpose | When to Run |
|--------|---------|-------------|
| `resume-resync.mjs` | Sync attendees from WooCommerce | Currently running |
| `rebuild-members.mjs` | Recalculate all membership statuses | After resync completes |
| `verify-resync.mjs` | Verify data integrity | After rebuild-members |
| `update-loops-list-config.mjs` | Update list ID in config | After renaming list in Loops |
| `bulk-sync-to-loops.mjs` | Initial population of Loops list | After rebuild-members |

---

## Support

**Loops.so API Docs:**
- [List Management](https://loops.so/docs/contacts/mailing-lists)
- [Update Contact API](https://loops.so/docs/api-reference/update-contact)
- [API Reference](https://loops.so/docs/api-reference/intro)

**Your List ID:** `cmk4d1l3r00li0iz92h08a1da`

**Rate Limits:** 10 requests/second (automatically handled by our code)

---

## You're Almost Done! 🎉

Once the resync completes and you run the bulk sync, your Loops.so integration will be fully operational and maintaining itself automatically!
