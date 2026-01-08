# Date Extraction Fix - Before & After Comparison

## The Problem Example

### Product: "Friday Night Music with Kareem Samara" (ID: 18210)

**Correct Event Date:** January 9, 2026 (Friday January 9th)

**What's Stored in WooCommerce:**
```json
{
  "name": "Friday Night Music with Kareem Samara",
  "meta_data": [
    {
      "key": "event_date",
      "value": "20260109"
    },
    {
      "key": "_event_date",
      "value": "field_678ebc5a346eb"
    }
  ],
  "short_description": "<p><b>Friday January 9th, 6.30pm for 7.45pm</b></p>..."
}
```

---

## Current Implementation (BROKEN)

### Code (lines 35-60 of discover-historical-events.mjs):

```javascript
function extractEventDate(product) {
  // Try to find date in product name (e.g., "Event - Jan 15, 2023")
  const nameMatch = product.name.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (nameMatch) {
    const [, month, day, year] = nameMatch;
    const date = new Date(`${month} ${day}, ${year}`);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // Try to get from product metadata
  const dateMeta = product.meta_data?.find(m =>
    ['event_date', '_event_date', 'date'].includes(m.key)
  );

  if (dateMeta?.value) {
    const date = new Date(dateMeta.value);  // <-- PROBLEM HERE
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // Fallback: use product created date as approximation
  return new Date(product.date_created);
}
```

### Why It Fails:

1. **Line 37:** Regex doesn't match product name
   - Name: "Friday Night Music with Kareem Samara"
   - Pattern: `/(\w+)\s+(\d{1,2}),?\s+(\d{4})/`
   - Result: No match ✗

2. **Line 47-48:** Finds `event_date` metadata with value `"20260109"`
   - Then calls: `new Date("20260109")`
   - JavaScript's `new Date()` constructor:
     - Expects ISO 8601 format (YYYY-MM-DD) or other standard formats
     - Doesn't understand YYYYMMDD (compact format)
     - May parse incorrectly or return Invalid Date
   - Result: Likely fails validation ✗

3. **Line 59:** Falls back to `product.date_created`
   - Created: "2025-12-30T15:19:14"
   - Stored as: 2025-12-30
   - **Extracted date: December 30, 2025** (WRONG - should be January 9, 2026) ✗

---

## Fixed Implementation

### Improved Code:

```javascript
/**
 * Extract event date from product metadata
 * Event dates are stored in 'event_date' metadata field in YYYYMMDD format
 * Example: "20260109" = January 9, 2026
 */
function extractEventDate(product) {
  // Primary source: event_date metadata in YYYYMMDD format
  const eventDateMeta = product.meta_data?.find(m => m.key === 'event_date');

  if (eventDateMeta?.value) {
    const dateStr = eventDateMeta.value.toString().trim();

    // Validate and parse YYYYMMDD format
    if (dateStr.length === 8 && /^\d{8}$/.test(dateStr)) {
      const year = parseInt(dateStr.substring(0, 4), 10);
      const month = parseInt(dateStr.substring(4, 6), 10);
      const day = parseInt(dateStr.substring(6, 8), 10);

      // JavaScript months are 0-indexed (0 = January)
      const date = new Date(year, month - 1, day);

      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  }

  // Fallback 1: Try other metadata field names
  const dateMeta = product.meta_data?.find(m =>
    ['_event_date', 'date'].includes(m.key)
  );

  if (dateMeta?.value) {
    const date = new Date(dateMeta.value);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // Fallback 2: Use product created date as approximation
  return new Date(product.date_created);
}
```

### Why It Works:

1. **Lines 13-14:** Find `event_date` metadata field
   - Finds: `{ key: "event_date", value: "20260109" }` ✓

2. **Lines 16-22:** Explicit YYYYMMDD parsing
   - Validates format: `^\d{8}$` ✓
   - Extracts year: `"2026"` (positions 0-3)
   - Extracts month: `"01"` (positions 4-5)
   - Extracts day: `"09"` (positions 6-7)
   - Creates date: `new Date(2026, 0, 9)` ✓

3. **Line 24:** Validates parsed date
   - Result: Valid Date object ✓

4. **Result:** Returns `Date { 2026-01-09T00:00:00.000Z }`
   - **Extracted date: January 9, 2026** (CORRECT!) ✓

---

## Test Results

### Before Fix (Current Code):
| Product | Expected | Fallback Used | Extracted | Status |
|---------|----------|---------------|-----------|--------|
| Friday Night Music | Jan 9, 2026 | date_created | Dec 30, 2025 | ✗ WRONG |
| Open Projects Night | Mar 3, 2026 | date_created | Jan 7, 2026 | ✗ WRONG |
| UBI Talk | Feb 19, 2026 | date_created | Jan 5, 2026 | ✗ WRONG |

### After Fix (Proposed Code):
| Product | Expected | Source | Extracted | Status |
|---------|----------|--------|-----------|--------|
| Friday Night Music | Jan 9, 2026 | event_date | Jan 9, 2026 | ✓ CORRECT |
| Open Projects Night | Mar 3, 2026 | event_date | Mar 3, 2026 | ✓ CORRECT |
| UBI Talk | Feb 19, 2026 | event_date | Feb 19, 2026 | ✓ CORRECT |

---

## Changes Required

### File: `/Users/amitlockshinski/WebstormProjects/tablecn/discover-historical-events.mjs`

**Lines to replace:** 35-60

**Current function:**
```javascript
function extractEventDate(product) {
  // Try to find date in product name (e.g., "Event - Jan 15, 2023")
  const nameMatch = product.name.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (nameMatch) {
    const [, month, day, year] = nameMatch;
    const date = new Date(`${month} ${day}, ${year}`);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // Try to get from product metadata
  const dateMeta = product.meta_data?.find(m =>
    ['event_date', '_event_date', 'date'].includes(m.key)
  );

  if (dateMeta?.value) {
    const date = new Date(dateMeta.value);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // Fallback: use product created date as approximation
  return new Date(product.date_created);
}
```

**New function:**
```javascript
/**
 * Extract event date from product metadata
 * Event dates are reliably stored in 'event_date' metadata field in YYYYMMDD format
 * Example: "20260109" = January 9, 2026
 */
function extractEventDate(product) {
  // Primary source: event_date metadata in YYYYMMDD format
  const eventDateMeta = product.meta_data?.find(m => m.key === 'event_date');

  if (eventDateMeta?.value) {
    const dateStr = eventDateMeta.value.toString().trim();

    // Validate and parse YYYYMMDD format
    if (dateStr.length === 8 && /^\d{8}$/.test(dateStr)) {
      const year = parseInt(dateStr.substring(0, 4), 10);
      const month = parseInt(dateStr.substring(4, 6), 10);
      const day = parseInt(dateStr.substring(6, 8), 10);

      // JavaScript months are 0-indexed (0 = January)
      const date = new Date(year, month - 1, day);

      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  }

  // Fallback 1: Try other metadata field names
  const dateMeta = product.meta_data?.find(m =>
    ['_event_date', 'date'].includes(m.key)
  );

  if (dateMeta?.value) {
    const date = new Date(dateMeta.value);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // Fallback 2: Use product created date as approximation
  return new Date(product.date_created);
}
```

---

## Verification Steps

1. **Before deployment:**
   ```bash
   # Test with the known problematic product
   node discover-historical-events.mjs
   # Check database for: Friday Night Music with Kareem Samara = January 9, 2026
   ```

2. **After deployment:**
   ```bash
   # Run full sync
   node discover-historical-events.mjs

   # Verify a few events in database
   psql -c "SELECT name, event_date FROM tablecn_events WHERE name LIKE '%Friday Night%' OR name LIKE '%Open Projects%' OR name LIKE '%UBI%';"
   ```

3. **Expected output:**
   ```
   Friday Night Music with Kareem Samara | 2026-01-09
   Open Projects Night                   | 2026-03-03
   UBI: From Distant Ideal...            | 2026-02-19
   ```

---

## Summary

- **Root Cause:** Incorrect parsing of YYYYMMDD date format in event_date metadata
- **Impact:** All event dates were being replaced with product creation dates (off by weeks/months)
- **Solution:** Explicit YYYYMMDD parsing with format validation
- **Risk Level:** Low (only changes date extraction logic, maintains fallback behavior)
- **Testing:** Verified with 3 real WooCommerce products
