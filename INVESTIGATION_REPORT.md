# WooCommerce Event Date Investigation Report

## Executive Summary

The investigation successfully identified how WooCommerce products store event date information. The accurate event dates are stored in the **`event_date` metadata field** with a consistent **YYYYMMDD format**.

The example mentioned in the context ("Friday Night Music with Kareem Samara" should be January 9th) was confirmed to have the correct date stored as `event_date: "20260109"`.

---

## Investigation Methodology

A Node.js script was created to fetch real WooCommerce products via the REST API and examine their complete structure, including:
- Basic product information (ID, type, status, dates)
- Product categories
- Product descriptions
- All metadata fields
- Product attributes
- Product variations (if variable product)

Three recent event products were analyzed in detail.

---

## Key Findings

### 1. The Reliable Date Source: `event_date` Metadata Field

**Location:** `product.meta_data` array, key: `"event_date"`

**Format:** YYYYMMDD (string)
- Year: positions 0-3
- Month: positions 4-5
- Day: positions 6-7

**Data Structure:**
```json
{
  "key": "event_date",
  "value": "20260109"
}
```

### 2. Test Products - Confirmed Accuracy

#### Product 1: Friday Night Music with Kareem Samara
- **WooCommerce ID:** 18210
- **event_date metadata:** `"20260109"`
- **Parsed Date:** January 9, 2026
- **Short Description:** "Friday January 9th, 6.30pm for 7.45pm"
- **Status:** ✓ CORRECT - Date matches description

#### Product 2: Open Projects Night
- **WooCommerce ID:** 18317
- **event_date metadata:** `"20260303"`
- **Parsed Date:** March 3, 2026
- **Short Description:** "Tuesday March 3rd, 6.30 for 7pm"
- **Status:** ✓ CORRECT - Date matches description

#### Product 3: UBI: From Distant Ideal to Transformative Policy with Kate Pickett
- **WooCommerce ID:** 18258
- **event_date metadata:** `"20260219"`
- **Parsed Date:** February 19, 2026
- **Short Description:** "Thursday February 19th, 6.30 for 7pm"
- **Status:** ✓ CORRECT - Date matches description

---

## Why Current Implementation May Fail

### Issue 1: Regex Pattern Mismatch
The current regex attempts to extract dates from the product name:
```javascript
const nameMatch = product.name.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
```

**Problem:** Event product names do NOT contain dates
- Example name: "Friday Night Music with Kareem Samara"
- No date pattern matches

### Issue 2: Metadata Field Parsing
Current code checks for metadata keys: `['event_date', '_event_date', 'date']`

The `event_date` field IS found, but:
```javascript
const date = new Date(dateMeta.value); // new Date("20260109")
```

**Problem:** `new Date("20260109")` doesn't parse YYYYMMDD format correctly
- It may interpret it as a timezone-affected conversion or fail silently
- Result: Incorrect or fallback date is used

---

## Other Data Locations (Not Reliable)

### Secondary Date Sources Found:
1. **`_event_date` metadata field:** Contains `"field_678ebc5a346eb"` (ACF field reference, not the actual date)
2. **Short description:** Contains human-readable date (requires complex parsing)
3. **Product created date (`date_created`):** Shows when product was created in WooCommerce, not the event date
4. **Product description:** Full HTML content, date not in structured format
5. **Attributes:** Contains "Ticket Type" attribute, no date information
6. **Variations:** No date information in variations

---

## Recommended Fix for `extractEventDate()` Function

Replace the current implementation with explicit YYYYMMDD parsing:

```javascript
/**
 * Extract event date from product metadata
 * Event dates are stored in 'event_date' metadata field in YYYYMMDD format
 */
function extractEventDate(product) {
  // Primary source: event_date metadata (most reliable)
  // Format: YYYYMMDD (e.g., "20260109" for January 9, 2026)
  const eventDateMeta = product.meta_data?.find(m => m.key === 'event_date');

  if (eventDateMeta?.value) {
    const dateStr = eventDateMeta.value.toString().trim();

    // Parse YYYYMMDD format
    if (dateStr.length === 8 && /^\d{8}$/.test(dateStr)) {
      const year = parseInt(dateStr.substring(0, 4), 10);
      const month = parseInt(dateStr.substring(4, 6), 10);
      const day = parseInt(dateStr.substring(6, 8), 10);

      const date = new Date(year, month - 1, day); // Month is 0-indexed in JS
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  }

  // Fallback 1: Try other common metadata field names
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

## Implementation Checklist

- [ ] Update `extractEventDate()` function in `/Users/amitlockshinski/WebstormProjects/tablecn/discover-historical-events.mjs` (lines 35-60)
- [ ] Add explicit YYYYMMDD parsing logic
- [ ] Keep the existing fallback behavior
- [ ] Test with known problematic product (Friday Night Music with Kareem Samara, ID: 18210)
- [ ] Run full discover-historical-events.mjs script
- [ ] Verify dates in database match expected values

---

## Investigation Files

- **Investigation Script:** `/Users/amitlockshinski/WebstormProjects/tablecn/investigate-product-structure.mjs`
- **Current Implementation:** `/Users/amitlockshinski/WebstormProjects/tablecn/discover-historical-events.mjs` (lines 35-60)
- **Credentials Used:** From `.env` file (WooCommerce REST API v3)

---

## Conclusion

The `event_date` metadata field with YYYYMMDD format is the most reliable and consistent source for event dates in WooCommerce products. The current implementation's failure to properly parse this format is the root cause of inaccurate date extraction. The recommended fix is straightforward and will resolve the date accuracy issues.
