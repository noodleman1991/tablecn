# Manual Refresh Instructions

✅ **Database Cleanup Complete!**
   - Deleted 58 attendees for "Why Look at Animals" event

## Next Step: Trigger Resync

The dev server has compilation errors due to missing drizzle-orm module, so we need to restart it after fixing dependencies.

### Option 1: Restart Dev Server (Recommended)
```bash
# Kill the current dev server
lsof -i :3001 | grep LISTEN | awk '{print $2}' | xargs kill

# Reinstall dependencies to fix drizzle-orm issue
pnpm install

# Restart dev server
pnpm run dev
```

### Option 2: Direct Database Approach
Write a standalone script using pg client to:
1. Fetch orders from WooCommerce API
2. Extract ticket data
3. Insert into database

But this would duplicate the sync logic - better to fix the dev server.

## Current Status
- ✅ Database cleaned (58 attendees deleted)
- ⚠️  Dev server has module errors
- ⏳ Waiting for resync to repopulate with correct data (should be 46 tickets)
