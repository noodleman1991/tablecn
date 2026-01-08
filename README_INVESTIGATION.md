# WooCommerce Event Date Investigation - Quick Start

## What Was Found

Event dates in WooCommerce are stored in a **metadata field called `event_date`** with format **YYYYMMDD**.

Example: Product ID 18210 "Friday Night Music with Kareem Samara" has `event_date: "20260109"` which correctly represents January 9, 2026.

## The Problem

The current `discover-historical-events.mjs` script finds this field but fails to parse the YYYYMMDD format:
```javascript
const date = new Date("20260109"); // ← This doesn't work!
```

This causes the script to fall back to using `product.date_created`, which is wrong (typically weeks/months off).

## The Solution

Replace the `extractEventDate()` function (lines 35-60) with explicit YYYYMMDD parsing:

```javascript
function extractEventDate(product) {
  // Parse event_date metadata in YYYYMMDD format
  const eventDateMeta = product.meta_data?.find(m => m.key === 'event_date');

  if (eventDateMeta?.value) {
    const dateStr = eventDateMeta.value.toString().trim();

    if (dateStr.length === 8 && /^\d{8}$/.test(dateStr)) {
      const year = parseInt(dateStr.substring(0, 4), 10);
      const month = parseInt(dateStr.substring(4, 6), 10);
      const day = parseInt(dateStr.substring(6, 8), 10);
      const date = new Date(year, month - 1, day);

      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  }

  // Keep existing fallback logic...
  const dateMeta = product.meta_data?.find(m =>
    ['_event_date', 'date'].includes(m.key)
  );

  if (dateMeta?.value) {
    const date = new Date(dateMeta.value);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  return new Date(product.date_created);
}
```

## Files to Review

1. **DATE_EXTRACTION_FIX.md** - Complete before/after comparison with exact code
2. **INVESTIGATION_REPORT.md** - Full methodology and test results
3. **METADATA_REFERENCE.json** - Complete reference of all WooCommerce metadata fields examined
4. **INVESTIGATION_SUMMARY.txt** - Quick reference guide

## Verified Products

All test products confirmed accurate:

| Product | ID | event_date | Expected Date | Status |
|---------|-----|-----------|---|--------|
| Friday Night Music with Kareem Samara | 18210 | 20260109 | Jan 9, 2026 | ✓ |
| Open Projects Night | 18317 | 20260303 | Mar 3, 2026 | ✓ |
| UBI: From Distant Ideal... | 18258 | 20260219 | Feb 19, 2026 | ✓ |

## How to Test

```bash
# Run the script
node discover-historical-events.mjs

# Check database for correct dates
psql -c "SELECT name, event_date FROM tablecn_events LIMIT 10;"
```

Expected: All event dates should match descriptions (e.g., "Friday January 9th" = 2026-01-09)

## Implementation Risk

**LOW RISK**
- Only changes date parsing logic
- Maintains all fallback behavior
- No breaking changes
- Backwards compatible

---

For complete details, see the comprehensive documentation files listed above.
