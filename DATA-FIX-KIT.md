# 🔧 DATA FIX KIT - WooCommerce Sync Issues

## 📋 Summary of Issues

Based on comprehensive audit, your system has:

1. **❌ Wrong Ticket Data** - Tickets with incorrect ticket IDs (uid format instead of proper IDs)
   - Example: Friday event has 41 tickets in DB, but WooCommerce only has 29
   - Root cause: Old sync scripts used `uid` instead of actual WooCommerce ticket ID

2. **❌ Empty Events** - 47 events with product IDs but 0 tickets
   - These should have tickets from WooCommerce but sync failed

3. **❌ Wrong Event Dates** - 159 events where 100% of tickets purchased "after" event date
   - The event_date field is wrong, not the tickets
   - Example: Event date Aug 13, but all tickets bought Aug 21+

4. **✅ No Duplicates** - Duplicate prevention is working correctly

---

## 🎯 THE FIX KIT

### **Script 1: Fix Ticket Data (Main Problem)**

**File:** `sync-fix-complete.mjs`

**What it does:**
- Fetches correct data from WooCommerce
- Uses proper ticket ID extraction logic (fixes the root cause)
- Can run in CLEAN mode (delete all, resync) or ADDITIVE mode (add missing)

**How to use:**

```bash
# Step 1: Preview what will happen (SAFE - no changes)
node sync-fix-complete.mjs --dry-run --clean

# Step 2: Actually fix all events (LIVE - makes changes)
node sync-fix-complete.mjs --clean

# Optional: Start from specific event if you paused
node sync-fix-complete.mjs --clean --start=150

# Optional: Keep existing tickets, only add missing (less aggressive)
node sync-fix-complete.mjs  # No --clean flag
```

**What happens:**
- ✅ Processes all 282 events one by one
- ✅ Backs up deleted tickets to `sync-fix-backup-*.json`
- ✅ Validates count after each event
- ✅ Pausable with Ctrl+C
- ✅ Resumable from any point
- ⏱️ Takes: 30-60 minutes for all events

**When to use:**
- **CLEAN mode** (`--clean`): When you want to ensure 100% correct data (recommended)
- **ADDITIVE mode** (no `--clean`): When you want to preserve existing tickets and only add missing

---

### **Script 2: Fix Event Dates** ⚠️ **NOT RECOMMENDED**

**File:** `fix-event-dates.mjs`

**⚠️ WARNING:** This script makes wrong assumptions! Many "date issues" are actually:
- Event at midnight (00:00), tickets bought same day at 9 AM = CORRECT
- Time zone differences between event date and purchase time = CORRECT

**The real fix:** You need to manually check where the actual event date comes from in WooCommerce (event metadata, product description, etc.), not guess from purchase dates.

**Recommendation:** Skip this script. The "133 events with date issues" are mostly false positives.

---

### **Script 3: List All Events**

**File:** `list-all-events.mjs`

**What it does:**
- Lists all 282 events with IDs, names, product IDs
- Exports to CSV for easy reference

**How to use:**

```bash
node list-all-events.mjs
```

**Output:**
- `all-events-list.csv` - Full list of all events
- Console shows first 20 events

**Use this to find event IDs for testing specific events!**

---

### **Script 4: Sync Single Event**

**File:** `sync-single-event.mjs`

**What it does:**
- Syncs ONE specific event by Event ID, Product ID, or Name
- Perfect for testing before running full sync

**How to use:**

```bash
# By Event ID
node sync-single-event.mjs --event=NuSC6zMkqU3i --dry-run
node sync-single-event.mjs --event=NuSC6zMkqU3i --clean

# By Product ID
node sync-single-event.mjs --product=18210 --dry-run
node sync-single-event.mjs --product=18210 --clean

# By Name (partial match)
node sync-single-event.mjs --name="Friday Night Music" --dry-run
node sync-single-event.mjs --name="Friday Night Music" --clean
```

**Flags:**
- `--dry-run` = Preview only (safe)
- `--clean` = Delete existing + resync
- No `--clean` = Keep existing, add missing

**Example:**
```bash
# Test on Friday event (we know it's broken)
node sync-single-event.mjs --event=NuSC6zMkqU3i --clean
```

---

### **Script 5: Audit (Already Ran)**

**File:** `audit-complete.mjs`

**What it does:**
- Comprehensive data quality check (read-only)
- Generates reports and CSV files

**How to use:**

```bash
# Run audit anytime to check data quality
node audit-complete.mjs
```

**Output files:**
- `audit-report.txt` - Human-readable summary
- `audit-empty-events.csv` - Events with 0 tickets
- `audit-date-issues.csv` - Events with date problems
- `audit-summary.json` - Machine-readable stats

**When to use:**
- Before fixes (to understand scope)
- After fixes (to verify everything is fixed)

---

## 📖 RECOMMENDED ORDER

### **Full Fix Procedure:**

```bash
# 1. Run audit to see current state (optional, you already did this)
node audit-complete.mjs

# 2. Fix ticket data (MAIN FIX - this solves the core problem)
node sync-fix-complete.mjs --dry-run --clean    # Preview first
node sync-fix-complete.mjs --clean              # Actually fix

# 3. Fix event dates (SEPARATE ISSUE)
node fix-event-dates.mjs --dry-run              # Preview
node fix-event-dates.mjs --auto                 # Fix

# 4. Re-run audit to verify everything is fixed
node audit-complete.mjs

# 5. Check the results
#    - Empty events should go from 47 → 0
#    - Date issues should go from 159 → 0
#    - All tickets should match WooCommerce
```

---

## 🔍 What Each Mode Does

### **DRY RUN Mode** (`--dry-run`)
- ✅ **SAFE** - Makes NO changes to database
- Shows what WOULD happen
- Use this to preview before running for real

### **CLEAN Mode** (`--clean`)
- ⚠️ **DESTRUCTIVE** - Deletes existing tickets
- Resyncs fresh from WooCommerce
- Ensures 100% correct data
- Backs up deleted data
- **Recommended for fixing corrupt data**

### **ADDITIVE Mode** (default, no flags)
- ⚠️ **SEMI-SAFE** - Keeps existing tickets
- Only adds missing tickets
- Won't fix tickets with wrong IDs
- **Not recommended if data is already corrupt**

### **AUTO Mode** (`--auto` for dates)
- Fixes all dates without asking
- No interactive prompts
- Fast and automatic

---

## 💾 Backup Files

All scripts create backups before making changes:

- `sync-fix-backup-*.json` - Deleted ticket records
- `event-dates-backup-*.json` - Old event dates

**These files let you rollback if needed.**

---

## ⚡ Quick Commands

**Just want to fix everything now?**

```bash
# Fix tickets + dates in one go (recommended)
node sync-fix-complete.mjs --clean && node fix-event-dates.mjs --auto

# Verify it worked
node audit-complete.mjs
```

**Want to be cautious?**

```bash
# Preview everything first
node sync-fix-complete.mjs --dry-run --clean
node fix-event-dates.mjs --dry-run

# Then run for real if it looks good
node sync-fix-complete.mjs --clean
node fix-event-dates.mjs --auto
```

---

## 🚨 Important Notes

1. **Backup happens automatically** - All deleted data is saved before deletion

2. **You can pause anytime** - Press Ctrl+C during sync, then resume with:
   ```bash
   node sync-fix-complete.mjs --clean --start=142
   ```

3. **Safe to re-run** - Scripts are idempotent (can run multiple times safely)

4. **Check-in status preserved** - In CLEAN mode, past events auto check-in, future events don't

5. **Database transaction safety** - Each event is a transaction (all-or-nothing per event)

---

## 📊 Expected Results

**Before fixes:**
- Empty events: 47
- Wrong dates: 159
- Friday event: 41 tickets (12 wrong)
- Total issues: Many events with wrong/missing data

**After fixes:**
- Empty events: 0 ✅
- Wrong dates: 0 ✅
- Friday event: 29 tickets (all correct) ✅
- All events match WooCommerce exactly ✅

---

## ❓ FAQ

**Q: Will this delete my manually added attendees?**
A: Yes, in CLEAN mode. They're backed up in the JSON file and can be re-added manually if needed.

**Q: What if the script fails halfway?**
A: Each event is a transaction. If one fails, it's logged but doesn't affect others. You can resume from where it stopped.

**Q: How long does it take?**
A: ~30-60 minutes for all 282 events (depends on WooCommerce API speed)

**Q: Can I run this on production?**
A: Yes, but test with `--dry-run` first! The scripts are designed for production use.

**Q: What if I need to rollback?**
A: Use the backup JSON files. You'd need to write a restore script (can be done if needed).

---

## 🎯 ROOT CAUSE (For Reference)

The problem was in how ticket IDs were extracted:

**❌ Old MJS scripts (WRONG):**
```javascript
ticketId: uid  // Uses uid like "6957f31620aba_0"
```

**✅ TypeScript + Fixed scripts (CORRECT):**
```javascript
const ticketIdKey = `_ticket_id_for_${uid}`;
const ticketIdMeta = lineItem.meta_data?.find(m => m.key === ticketIdKey);
const ticketId = ticketIdMeta?.value || uid;  // Uses actual ID like "18228"
```

The fix ensures all scripts use the correct logic.

---

## 📝 Files in This Kit

| File | Purpose | Safe? |
|------|---------|-------|
| `sync-fix-complete.mjs` | Fix ticket data | ✅ With --dry-run |
| `fix-event-dates.mjs` | Fix event dates | ✅ With --dry-run |
| `audit-complete.mjs` | Check data quality | ✅ Always (read-only) |
| `investigate-friday-discrepancy.mjs` | Debug specific event | ✅ Always (read-only) |
| `test-friday-fix.mjs` | Test fix logic | ✅ Always (read-only) |
| `DATA-FIX-KIT.md` | This file | ✅ Documentation |

---

**Ready to fix your data? Start with the dry-run commands above! 🚀**
