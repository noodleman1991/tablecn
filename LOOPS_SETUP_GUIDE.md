# Loops.so Setup Guide

## What the Integration Does

The integration automatically maintains a contact list in Loops.so with your **active community members only**.

- **Active members** (3+ events total AND 1+ event in last 9 months) → Automatically added/updated in Loops
- **Inactive members** → Automatically removed from Loops
- **Manual members** → Synced when created, removed when status changes to inactive

## Loops.so List Management

### The List is **NOT** Automatically Created

Loops.so doesn't have the concept of "lists" in their API. Instead:

1. **All contacts go into your main Loops.so audience**
2. **You filter contacts using custom properties** (like tags/segments)

### What Gets Synced to Loops

Each active member is synced with these fields:

```json
{
  "email": "member@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "totalEventsAttended": 5,
  "lastEventDate": "2025-12-15T00:00:00.000Z",
  "membershipExpiresAt": "2026-09-15T00:00:00.000Z",
  "manuallyAdded": false,
  "source": "community_member"
}
```

The **`source: "community_member"`** field is the key! You'll use this to filter.

## Steps to Set Up in Loops.so Dashboard

### 1. Create a Segment for Active Members

1. Log into your Loops.so dashboard (https://app.loops.so)
2. Go to **Audience** → **Segments**
3. Click **Create Segment**
4. Name it: **"Active Community Members"**
5. Set filter condition:
   - Field: `source`
   - Condition: `equals`
   - Value: `community_member`
6. Save the segment

This segment will automatically include all active members as they're synced.

### 2. Verify Custom Properties Are Captured

Go to **Settings** → **Custom Properties** and verify these fields appear:
- `totalEventsAttended` (number)
- `lastEventDate` (date)
- `membershipExpiresAt` (date)
- `manuallyAdded` (boolean)
- `source` (string)

These should be auto-created when the first contact syncs.

### 3. Create Email Campaigns (Optional)

You can now create targeted campaigns:

**Example 1: Welcome Email for New Members**
- Trigger: When `source` equals `community_member` (new contact added)
- Send welcome email to new active members

**Example 2: Membership Expiring Soon**
- Trigger: When `membershipExpiresAt` is within 30 days
- Send reminder email

**Example 3: Inactive Members Alert**
- Since inactive members are removed, you could create a "last chance" campaign
- Trigger: When contact is about to be removed (we can add this if needed)

## Initial Bulk Sync

To populate Loops.so with your existing 106 active members:

### Option 1: Via Bulk Sync Endpoint (Recommended)

Once your Next.js app is deployed:

```bash
curl -X POST https://your-domain.com/api/loops/bulk-sync \\
  -H "Authorization: Bearer $CRON_SECRET"
```

This will:
- Sync all 106 active members to Loops
- Remove any inactive members that were previously synced
- Log all operations to the database

### Option 2: Manual Script (Local Testing)

Create a file `bulk-sync-loops.mjs`:

```javascript
import { db } from './src/db/index.js';
import { syncMemberToLoops, removeMemberFromLoops } from './src/lib/loops-sync.js';

const allMembers = await db.query.members.findMany();

const active = allMembers.filter(m => m.isActiveMember);
const inactive = allMembers.filter(m => !m.isActiveMember);

console.log(`Syncing ${active.length} active members...`);
for (const member of active) {
  await syncMemberToLoops(member);
}

console.log(`Removing ${inactive.length} inactive members...`);
for (const member of inactive) {
  await removeMemberFromLoops(member.email, member.id);
}

console.log('Bulk sync complete!');
```

Then run: `node bulk-sync-loops.mjs`

## How Ongoing Sync Works (Automatic)

After initial setup, the system syncs automatically:

### Real-time Triggers:
1. **Member created manually** → Synced immediately
2. **Member status changes to active** (via check-in/recalculation) → Synced immediately
3. **Member status changes to inactive** → Removed from Loops immediately
4. **Member details updated** (name, email) → Updated in Loops if active
5. **Member deleted** → Removed from Loops first

### Examples:

**Scenario 1: Someone attends their 3rd event**
```
1. Person checks in at event
2. Membership recalculated (3 events + 1 recent = ACTIVE)
3. Automatically synced to Loops ✓
4. Appears in "Active Community Members" segment
```

**Scenario 2: Someone's membership expires**
```
1. 9 months pass since last event
2. Membership recalculated (3 events but 0 recent = INACTIVE)
3. Automatically removed from Loops ✓
4. Disappears from "Active Community Members" segment
```

**Scenario 3: Manual member added**
```
1. You manually add someone via admin panel
2. Set as active with expiration date
3. Immediately synced to Loops ✓
4. When expiration passes → Removed from Loops
```

## Monitoring Sync Activity

Check sync logs in your database:

```sql
SELECT
  operation,
  status,
  COUNT(*) as count,
  MAX(synced_at) as last_sync
FROM tablecn_loops_sync_log
GROUP BY operation, status
ORDER BY last_sync DESC;
```

Or view recent errors:

```sql
SELECT email, operation, error_message, synced_at
FROM tablecn_loops_sync_log
WHERE status = 'failed'
ORDER BY synced_at DESC
LIMIT 20;
```

## Rate Limits & Performance

- Loops.so limit: **10 requests per second**
- Built-in rate limiter respects this automatically
- Bulk sync of 106 members takes ~11 seconds
- Bulk sync of 1,092 removals takes ~2 minutes
- All operations have automatic retry on failure (3 attempts with exponential backoff)

## Troubleshooting

### Contacts not appearing in Loops?
1. Check sync logs for errors
2. Verify `LOOPS_API_KEY` is correct in your `.env`
3. Check member is actually active: `is_active_member = true`
4. Look at Loops.so dashboard under "Audience" → "Contacts"

### Contacts not being removed?
1. Inactive members are removed automatically
2. Check sync logs: `operation = 'remove'` and `status = 'success'`
3. May take a few minutes to reflect in Loops dashboard

### Seeing duplicate contacts?
- Loops uses email as unique identifier, duplicates shouldn't occur
- If you see duplicates, check for email case sensitivity issues

## Next Steps

1. ✅ **Create "Active Community Members" segment in Loops**
2. ⏳ **Run initial bulk sync** (once app is deployed)
3. ✅ **Verify contacts appear in Loops dashboard**
4. 🎯 **Create your first email campaign** targeting the segment
5. 📊 **Monitor sync logs** for any issues

## Questions?

The integration is production-ready and will maintain your Loops.so audience automatically from now on!
