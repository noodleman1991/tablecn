# Event Date Accuracy Fix - COMPLETE ✅

## Problem Identified

**Issue**: Event dates in the database didn't match actual WooCommerce event information.

**Example**: "Friday Night Music with Kareem Samara" should be January 9th, 2026, but database had incorrect date.

**Root Cause**: The `discover-historical-events.mjs` script was failing to parse WooCommerce's date format correctly.

---

## How WooCommerce Stores Event Dates

WooCommerce stores event dates in the `event_date` metadata field using **YYYYMMDD format**:

- Format: `"20260109"` (8 digits)
- Meaning: `2026-01-09` (January 9, 2026)

The old code tried to parse this with `new Date("20260109")`, which JavaScript doesn't understand, causing it to fall back to the product creation date (wrong).

---

## Fix Applied ✅

**File Modified**: `/Users/amitlockshinski/WebstormProjects/tablecn/discover-historical-events.mjs`

**Function Updated**: `extractEventDate()` (lines 35-76)

### What Changed:

**BEFORE** (broken):
```javascript
if (dateMeta?.value) {
  const date = new Date(dateMeta.value); // ❌ Fails for "20260109"
  if (!isNaN(date.getTime())) {
    return date;
  }
}
```

**AFTER** (fixed):
```javascript
if (dateMeta?.value) {
  const dateStr = dateMeta.value.toString();

  // Parse YYYYMMDD format (e.g., "20260109" = Jan 9, 2026)
  if (/^\d{8}$/.test(dateStr)) {
    const year = parseInt(dateStr.substring(0, 4), 10);   // "2026"
    const month = parseInt(dateStr.substring(4, 6), 10) - 1; // "01" - 1 = 0 (January)
    const day = parseInt(dateStr.substring(6, 8), 10);     // "09"

    const date = new Date(year, month, day); // ✅ Correctly creates Jan 9, 2026
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
}
```

---

## Verification

The fix was tested against **3 live WooCommerce products**:

| Event | Product ID | event_date | Parsed Result | Status |
|-------|-----------|-----------|--------------|---------|
| Friday Night Music with Kareem Samara | 18210 | `"20260109"` | Jan 9, 2026 | ✅ Correct |
| Open Projects Night | 18317 | `"20260303"` | Mar 3, 2026 | ✅ Correct |
| UBI: From Distant Ideal to Policy | 18258 | `"20260219"` | Feb 19, 2026 | ✅ Correct |

**Confidence Level**: High (100% success rate on tested products)

---

## Next Steps

Now that the date extraction is fixed, follow these steps:

### 1. Run Database Migration (if not done yet)

```bash
pnpm db:generate
pnpm db:push
```

**Answer prompts**:
- For table renames: Select `~ shadcn_* › tablecn_*` (rename options)
- For new columns: Select `+ column_name` (create options)

### 2. Re-run Event Discovery with Accurate Dates

This will update existing events with correct dates:

```bash
node discover-historical-events.mjs
```

**Expected behavior**:
- Creates new events (if missing)
- **Updates existing events** with corrected dates
- Shows warnings if any events don't have `event_date` metadata

### 3. Resume Resync from Event 184

After event dates are corrected, resume the attendee sync:

```bash
node resume-resync.mjs 184
```

This will:
- Continue syncing attendees from event 184 onwards
- Use the now-correct event dates
- Auto check-in past events (before Jan 5, 2026)

### 4. Rebuild Community Members

```bash
node rebuild-members.mjs
```

### 5. Verify Everything

```bash
node verify-resync.mjs
```

---

## Alternative: Full Fresh Start

If you want to start completely fresh with accurate dates:

```bash
# 1. Migration (if not done)
pnpm db:generate && pnpm db:push

# 2. Clean duplicates
node cleanup-duplicates.mjs

# 3. Discover ALL events with accurate dates
node discover-historical-events.mjs

# 4. Full resync from beginning
node full-historical-resync.mjs

# 5. Rebuild members
node rebuild-members.mjs

# 6. Verify
node verify-resync.mjs
```

---

## What If Some Events Still Have Wrong Dates?

If you see warnings during discovery like:

```
⚠️ No event_date found for "Some Event", using creation date
```

This means that product doesn't have the `event_date` metadata field. You have two options:

1. **Add the metadata in WooCommerce**: Edit the product and add `event_date` custom field
2. **Manual correction**: Update the date in your database after discovery completes

---

## Summary

✅ **Root cause identified**: YYYYMMDD format parsing failure
✅ **Fix implemented**: Proper date parsing in `discover-historical-events.mjs`
✅ **Verification complete**: 3/3 products tested successfully
✅ **Documentation updated**: COMPLETE-RESYNC-GUIDE.md updated with date fix info

**Ready to proceed**: You can now re-run event discovery and resume the resync from event 184.
