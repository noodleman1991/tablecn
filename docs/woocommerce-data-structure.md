# WooCommerce Data Structure Reference

Reference for the WooCommerce REST API data used by this application.

**API Version**: `wc/v3`
**Store**: kairos.london
**Configured in**: `src/lib/woocommerce.ts`

## Order Object (`GET /wc/v3/orders`)

```
order {
  id: number                      // Order ID
  status: string                  // "completed" | "processing" | "on-hold" | "pending" | "cancelled" | "refunded" | "failed"
  date_created: string            // ISO timestamp
  billing: {
    first_name: string            // EXPLICIT — always available, never hashed
    last_name: string             // EXPLICIT — always available, never hashed
    email: string                 // EXPLICIT — always available
  }
  line_items: LineItem[]          // Purchased items (tickets)
}
```

**Note**: Most orders are `processing` status (~4900), very few are `completed` (~7). The app fetches both.

## Line Item Object

```
line_item {
  id: number                      // Line item ID
  product_id: number              // WooCommerce product ID
  variation_id: number            // For variable products
  quantity: string                // Number of tickets
  name: string                   // Product name (may include variant suffix like "- Standard")
  total: string                  // Price after discounts
  attributes: Attribute[]         // Variation selections (may be undefined)
  meta_data: MetaEntry[]          // Array of { key, value } pairs
}
```

## Line Item meta_data Keys

### `_ticket_data` — Hashed attendee fields

Array of ticket entries with **hashed** field keys (not human-readable).

```json
[{
  "key": "6467734912bc5",
  "product_id": 2034,
  "variation_id": "2036",
  "variations": { "attribute_pa_ticket-type": "non-member" },
  "uid": "6467734912bc5_0",
  "index": 0,
  "fields": {
    "ddf0c5e3362962d29180d9226f2e5be8": "Tom",
    "d6d93e88becfc567bb30ca978a237726": "Baker",
    "c276b415493b81614a98b061f511e8ff": "tomm91@gmail.com"
  },
  "order_item_id": 150
}]
```

### Global Hash Key Mapping

Validated 2026-03-31 across 38 products — all use the same hash keys:

| Hash Key | Field |
|----------|-------|
| `d6d93e88becfc567bb30ca978a237726` | **Last Name** |
| `ddf0c5e3362962d29180d9226f2e5be8` | **First Name** |
| `c276b415493b81614a98b061f511e8ff` | **Email** |
| `eaf4cc0d...` (partial) | **Membership Number** (optional, 4th field) |

**Important**: Alphabetically `d6d93e88` < `ddf0c5e3`, so sorting by key puts Last Name before First Name. The code in `sync-attendees.ts` handles this via multiple resolution strategies (see below).

### HTML Ticket Meta — Explicit Labels (Preferred)

WooCommerce also provides a **second meta entry** per ticket with an HTML key containing explicit field labels:

**Key**: `<span class="order-item-meta-ticket ticket-id-{ticketId}">Ticket #N</span>`

**Value**:
```html
<ul style="clear:both;">
  <li><strong>First Name</strong>: <span class="text">Tom</span></li>
  <li><strong>Last Name</strong>: <span class="text">Baker</span></li>
  <li><strong>Email</strong>: <span class="text">tomm91@gmail.com</span></li>
</ul>
```

This is the **definitive source** for field→name mapping. The code parses these labels first, falling back to hash key mapping if the HTML meta is unavailable.

### Other meta_data Keys

| Key | Description |
|-----|-------------|
| `_ticket_id_for_{uid}` | WooCommerce ticket ID for a specific ticket UID |
| `pa_ticket-type` | Ticket type attribute value (e.g., "standard", "non-member") |
| `_variation_attributes` | Variation attribute selections (object or array format) |
| `_reduced_stock` | Stock reduction flag |

## Name Resolution Priority

The code in `src/lib/sync-attendees.ts` uses this priority chain:

1. **HTML ticket meta** — Parse `<strong>Label</strong>: <span>Value</span>` pairs for explicit "First Name"/"Last Name"
2. **Known hash key mapping** — Match hash keys against the validated global mapping table above
3. **Alphabetical sort + swap detection** — Legacy fallback: sort hashed keys alphabetically, detect swaps using billing data comparison

## Product Object (`GET /wc/v3/products`)

```
product {
  id: number
  name: string                    // Product name (often includes event date)
  type: string                   // "simple" | "variable"
  categories: [{ id, name, slug }]
  tags: [{ id, name, slug }]
  attributes: [{
    id: number
    name: string                 // e.g., "Ticket Type"
    slug: string                 // e.g., "pa_ticket-type"
    position: number
    visible: boolean
    variation: boolean
    options: string[]
  }]
  variations: number[]           // Array of variation IDs (for variable products)
  meta_data: [{ key, value }]    // Includes event_date in various formats
}
```

### Qualifying Event Signal

A single WooCommerce signal determines if an event qualifies for community membership:

**Product Category: `qualifying-for-community-membership`** (id: 128)
- Slug: `qualifying-for-community-membership`
- Presence of this category on the product → event qualifies.
- Absence → does not qualify.

Resolution (in `isQualifyingEventProduct()` in `src/lib/woocommerce.ts`): returns `true` iff the category is present, otherwise `false`.

Stored as `is_qualifying_event` boolean in the `events` DB table.

**Insert-only from cron.** The `discover-events` cron sets `is_qualifying_event` only when creating a new row. On subsequent runs, the column is left untouched — manual DB fixes and the backfill migration (`0012_backfill_qualifying_events.sql`) are sticky.

> The previous `pa_qualifying-event` product attribute is retired (2026-04-14); the category is now the sole signal.

**`pa_ticket-type`** — "Ticket Type"
- Options: `"Standard"`, `"Under 30"`, `"Under 25"`, `"Struggling Financially"`, `"With Donation"`, `"Supporter"`, `"I Have a Credit"`

## Event Date Extraction

Event dates are extracted from products in this order:
1. Product name pattern: `"Event Name - DD/MM/YYYY"` or `"Event Name - YYYY-MM-DD"`
2. Product `meta_data` key `event_date` in `YYYYMMDD` or ISO format
