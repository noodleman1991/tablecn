# 🏗️ COMPLETE ARCHITECTURE & DATA FLOW DOCUMENTATION

## 📊 DATA SOURCE HIERARCHY (Source of Truth)

### **WooCommerce = PRIMARY SOURCE OF TRUTH**
- **Products** → Events
- **Orders** → Ticket purchases (can be single or multiple tickets per order, there is the booker details and the ticket holder ticket (the name on the ticket + email this is the important data point for calculating community membership))
- **Line Items** → Individual tickets
- **Meta Data** → Ticket details & event dates

### **Neon PostgreSQL = APPLICATION DATABASE**
- Stores synced data from WooCommerce
- Adds application-specific fields (check-in status, local modifications)
- Calculated/derived data (community membership status)

---

## 🔄 COMPLETE DATA FLOW: WooCommerce → Database → UI

### **STEP 1: WooCommerce Product Structure**

**WooCommerce Product** (represents an Event)
```
Product ID: 18210
Name: "Friday Night Music with Kareem Samara"
Type: variable | simple
Meta Data:
  - event_date: "20260109"        ← ACTUAL EVENT DATE (YYYYMMDD format)
  - _event_date: "field_678ebc5a346eb"
  - _ticket: "yes"
  - _ticket_fields: {...}         ← Defines ticket form fields
Categories: ["Tickets", "Music"]
Attributes:
  - Ticket Type: ["Standard", "Member", "Supporter"]
```
* all ticket types for each event should be under the one event (should not differentiate between tickets this is not important at the door )
**Key WooCommerce Fields:**
| WooCommerce Field | Format | Purpose |
|-------------------|--------|---------|
| `id` | Integer | Product ID (links to event) |
| `name` | String | Event name |
| `meta_data.event_date` | "YYYYMMDD" | **ACTUAL event date** |
| `type` | "simple"/"variable" | Product type |
| `variations` | Array | Variation IDs for variable products |

---

### **STEP 2: WooCommerce Order Structure**

**WooCommerce Order** (someone buys tickets)
```
Order ID: 18227
Date Created: "2026-01-07T22:23:22"
Status: "completed" | "processing" | "on-hold" | "pending"
Billing:
  - first_name: "Lina"
  - last_name: "Hayek"
  - email: "hi@sweetnutdesign.com"

Line Items: [
  {
    id: 12345,
    product_id: 18210,              ← Links to Event (Product)
    quantity: 2,
    meta_data: [
      {
        key: "_ticket_data",        ← CRITICAL: Individual ticket details
        value: [
          {
            uid: "6957f31620aba_0",  ← Internal UID (NOT the ticket ID!) (question: what do you mean - is this how it is found in woocommerce? what is the actual ticket id? where it can be found?)
            index: 0,
            fields: {
              "abc123": "Lina",      ← First name (hashed key)
              "def456": "Hayek",     ← Last name
              "ghi789": "hi@sweetnutdesign.com"  ← Email
            }
          },
          {
            uid: "6957f31620aba_1",
            index: 1,
            fields: {...}
          }
        ]
      },
      {
        key: "_ticket_id_for_6957f31620aba_0",  ← ACTUAL TICKET ID
        value: "18228"                           ← THIS is the real ticket number
      },
      {
        key: "_ticket_id_for_6957f31620aba_1",
        value: "18229"
      }
    ]
  }
]
```

**Key WooCommerce Order Fields:**
| WooCommerce Field | Maps To | Notes |
|-------------------|---------|-------|
| `order.id` | `woocommerce_order_id` | Order number |
| `order.date_created` | `woocommerce_order_date` | When order placed |
| `order.billing.first_name` | `booker_first_name` | Who bought tickets |
| `order.billing.last_name` | `booker_last_name` | |
| `order.billing.email` | `booker_email` | |
| `line_item.product_id` | Links to `woocommerce_product_id` | Which event |
| `meta._ticket_data[].uid` | NOT USED (internal only) | ⚠️ Common mistake! |
| `meta._ticket_id_for_{uid}` | `ticket_id` | **CORRECT ticket ID** | (question: and if there is more than 1 ticket?)
| `meta._ticket_data[].fields` | `first_name`, `last_name`, `email` | Attendee info |

---

### **STEP 3: Database Schema (Neon PostgreSQL)**

#### **Table: `tablecn_events`**

```sql
CREATE TABLE tablecn_events (
  id VARCHAR(30) PRIMARY KEY,                    -- Generated ID
  name VARCHAR(255) NOT NULL,                    -- From WC Product.name
  event_date TIMESTAMP NOT NULL,                 -- From WC meta_data.event_date
  woocommerce_product_id VARCHAR(128) UNIQUE,    -- WC Product ID
  merged_into_event_id VARCHAR(30),              -- For merging events
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Field Mapping:**
| Database Column | Source | Transformation |
|-----------------|--------|----------------|
| `id` | Generated | `generateId()` (nanoid) |
| `name` | WC `product.name` | Direct copy |
| `event_date` | WC `meta_data.event_date` | Parse "YYYYMMDD" → Date |
| `woocommerce_product_id` | WC `product.id` | String conversion |

---

#### **Table: `tablecn_attendees`**

```sql
CREATE TABLE tablecn_attendees (
  id VARCHAR(30) PRIMARY KEY,                    -- Generated ID
  event_id VARCHAR(30) NOT NULL,                 -- FK to tablecn_events.id
  email VARCHAR(255) NOT NULL,                   -- From ticket fields OR billing
  first_name VARCHAR(128),                       -- From ticket fields OR billing
  last_name VARCHAR(128),                        -- From ticket fields OR billing
  ticket_id VARCHAR(128),                        -- From _ticket_id_for_{uid}
  woocommerce_order_id VARCHAR(128),             -- WC Order ID
  woocommerce_order_date TIMESTAMP,              -- WC order.date_created
  booker_first_name VARCHAR(128),                -- WC billing.first_name
  booker_last_name VARCHAR(128),                 -- WC billing.last_name
  booker_email VARCHAR(255),                     -- WC billing.email
  locally_modified BOOLEAN DEFAULT FALSE,        -- App flag
  manually_added BOOLEAN DEFAULT FALSE,          -- App flag
  checked_in BOOLEAN DEFAULT FALSE,              -- App state
  checked_in_at TIMESTAMP,                       -- App state
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT unique_ticket_per_event UNIQUE (ticket_id, event_id)
);
```

**Field Mapping:**
| Database Column | WooCommerce Source | Notes |
|-----------------|-------------------|-------|
| `id` | Generated | `generateId()` | 
| `event_id` | `events.id` where `woocommerce_product_id = line_item.product_id` | Join logic |
| `email` | `_ticket_data[i].fields[{email_key}]` OR `order.billing.email` | Email field detected by `@` |
| `first_name` | `_ticket_data[i].fields[{first_key}]` OR `order.billing.first_name` | First non-email field |
| `last_name` | `_ticket_data[i].fields[{second_key}]` OR `order.billing.last_name` | Second non-email field |
| `ticket_id` | `meta_data._ticket_id_for_{uid}.value` | ⚠️ **NOT** the `uid`! |
| `woocommerce_order_id` | `order.id` | String |
| `woocommerce_order_date` | `order.date_created` | ISO Date |
| `booker_*` | `order.billing.*` | Who bought (not attendee) |
| `checked_in` | App logic | `true` if past event, `false` if future |
| `checked_in_at` | App logic | `event_date` if auto-checked |

---

#### **Table: `tablecn_members`**

```sql
CREATE TABLE tablecn_members (
  id VARCHAR(30) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  first_name VARCHAR(128),
  last_name VARCHAR(128),
  is_active_member BOOLEAN DEFAULT FALSE,        -- Calculated
  total_events_attended REAL DEFAULT 0,          -- Calculated
  membership_expires_at TIMESTAMP,               -- Calculated
  last_event_date TIMESTAMP,                     -- Calculated
  ...
);
```

**Calculated Fields:**
| Column | Calculation Logic | Source |
|--------|------------------|--------|
| `is_active_member` | Attended ≥3 events in last 365 days | `attendees` WHERE `checked_in = true` |
| `total_events_attended` | COUNT(DISTINCT events) | `attendees` WHERE `checked_in = true` |
| `membership_expires_at` | `last_event_date` + 365 days | Derived |
| `last_event_date` | MAX(`event_date`) | `attendees.event.event_date` WHERE `checked_in = true` |

---

## 🐛 THE BUGS: Where Things Go Wrong

### **BUG 1: Wrong Ticket ID Extraction** ✅ FIXED

**OLD (Broken) Logic in MJS scripts:**
```javascript
const { uid, fields } = ticketData;
ticketId: uid  // ❌ WRONG! Uses "6957f31620aba_0" instead of "18228"
```

**CORRECT Logic (TypeScript & fixed scripts):**
```javascript
const ticketIdKey = `_ticket_id_for_${uid}`;
const ticketIdMeta = lineItem.meta_data?.find(m => m.key === ticketIdKey);
const ticketId = ticketIdMeta?.value || uid;  // ✅ Uses "18228" (question: does this fallback to the uid? because this cannot be good in anycase this is just a madeup number)
```

**Impact:**
- Database filled with wrong ticket IDs (uid format)
- Duplicate check failed (different IDs = seen as different tickets - but actually is the same ticket) 
- Multiple sync runs created duplicate records - should prevent this base on ticket ids but also based on count check to validate the sync - or best practices ways 

---

### **BUG 2: Wrong Event Dates** ⚠️ ONGOING

**Source of Truth:**
```
WooCommerce Product Meta: event_date = "20260125"  (Jan 25, 2026)
```

**Database Shows:**
```
tablecn_events.event_date = "2026-01-09 00:00:00"  (Jan 9, 2026)
```

**Root Cause:**
- Unknown initial sync or manual data entry used wrong date
- Database never updated with WooCommerce `meta_data.event_date` field
- Scripts assumed database dates were correct

**Solution:**
- Read `product.meta_data.event_date` from WooCommerce
- Parse YYYYMMDD → Date
- Update `tablecn_events.event_date` to match

---

### **BUG 3: UI Not Showing Changes** ⚠️ NEEDS INVESTIGATION

**Observed:** Database has 30 tickets, UI shows 0 or old data

**Possible Causes:**

1. **Client-side Caching**
   - React query cache
   - Browser cache
   - Service worker cache

2. **Server-side Caching**
   - `woocommerce_cache` table (lines 113-122 in schema)
   - Application-level cache (Redis/memory)

3. **Stale Data Fetch**
   - UI queries old data before revalidation
   - Server components not revalidating

4. **Filter Logic**
   - UI only shows `checked_in = true` attendees
   - UI filters by date range
   - UI filters by `manually_added = false`

**Files to Check:**
- `src/app/actions.ts` - Data fetching functions
- `src/lib/cache-utils.ts` - Cache logic
- `src/app/components/*` - Display components
- `src/lib/sync-attendees.ts` - Sync & cache invalidation

---

## 📊 UI DISPLAY FLOW - not all table columns are shown or hidden based on view menu clicks - scroll on/off toggle is not functional - should allow scrolling and the view of columns should account for responsiveness - come up with a good combo in the ui of the needs (respoonsiveness and showing the data in columes)

### **Data Path: Database → Server → Client → Display**

**Step 1: Server Action** (`src/app/actions.ts`)
```typescript
export async function getAttendeesForEvent(eventId: string) {
  // Might trigger sync first
  const syncResult = await syncAttendeesForEvent(eventId);

  if (syncResult.cachedAttendees) {
    return syncResult.cachedAttendees;  // ← Could be stale!
  }

  // Query database
  return await db
    .select()
    .from(attendees)
    .where(eq(attendees.eventId, eventId))
    .orderBy(attendees.email);
  // ❓ Any filtering here?
}
```

**Step 2: Client Component**
```typescript
// Fetches data via server action
const attendees = await getAttendeesForEvent(eventId);

// Groups and displays
// ❓ Any client-side filtering?
```

**Step 3: Display**
- Data Table component
- Shows attendee rows
- **❓ Which columns are displayed?**
- **❓ Any hidden/conditional columns?**

---

## 🔍 COLUMN DISPLAY ISSUES

### **Why Columns Might Not Show:**

1. **Table Definition**
   - Column not in `columns` array
   - Column conditionally hidden
   - Column width set to 0

2. **Data Filtering**
   - Rows filtered out before display
   - Empty cell values treated as "no data"

3. **Responsive Design**
   - Columns hidden on smaller screens
   - CSS `display: none` on certain breakpoints

4. **Permissions**
   - Columns hidden based on user role
   - Admin-only columns

**Need to check:**
- Table column definitions
- CSS media queries
- Filter logic in components

---

## 🎯 COMPLETE DATA SYNC LOGIC

### **When Should Data Sync?**

**Trigger Points:**
1. User visits event check-in page
2. Manual sync button clicked
3. Scheduled sync (cron job)
4. API endpoint called

**Sync Logic:**
```typescript
async function syncAttendeesForEvent(eventId: string) {
  // 1. Check if event is past cutoff (23:00 on event day)
  if (pastCutoff) {
    return { synced: false, reason: "past_cutoff" };
  }

  // 2. Check cache age
  const cache = await getCachedData(eventId);
  if (cache && cacheAge < 8 hours) {
    return { synced: false, reason: "cached", cachedAttendees: cache };
  }

  // 3. Fetch from WooCommerce
  const orders = await getOrdersForProduct(productId);

  // 4. Extract tickets
  const tickets = extractTickets(orders);

  // 5. Check for duplicates
  const existing = await db.query(...);
  const newTickets = tickets.filter(t => !existing.has(t.ticketId));

  // 6. Insert new tickets
  await db.insert(attendees).values(newTickets);

  // 7. Update cache
  await setCachedData(eventId, allTickets);

  return { synced: true, created: newTickets.length };
}
```

---

## 📝 FIELD NAME MAPPINGS (Complete Reference)

### **WooCommerce → Database**

| WooCommerce API Path | Database Column | Type | Notes |
|---------------------|-----------------|------|-------|
| **PRODUCTS** |
| `product.id` | `woocommerce_product_id` | VARCHAR(128) | String conversion |
| `product.name` | `name` | VARCHAR(255) | Direct copy |
| `product.meta_data[key='event_date'].value` | `event_date` | TIMESTAMP | Parse "YYYYMMDD" |
| **ORDERS** |
| `order.id` | `woocommerce_order_id` | VARCHAR(128) | String conversion |
| `order.date_created` | `woocommerce_order_date` | TIMESTAMP | ISO Date parse |
| `order.billing.first_name` | `booker_first_name` | VARCHAR(128) | Direct copy |
| `order.billing.last_name` | `booker_last_name` | VARCHAR(128) | Direct copy |
| `order.billing.email` | `booker_email` | VARCHAR(255) | Lowercase |
| **LINE ITEMS** |
| `line_item.product_id` | → `event_id` (via join) | Lookup | Find event by product_id |
| `line_item.meta_data[key='_ticket_data'][i].uid` | NOT MAPPED | N/A | Internal only |
| `line_item.meta_data[key='_ticket_id_for_{uid}'].value` | `ticket_id` | VARCHAR(128) | **CRITICAL** |
| `line_item.meta_data[key='_ticket_data'][i].fields[{email}]` | `email` | VARCHAR(255) | Field with `@` |
| `line_item.meta_data[key='_ticket_data'][i].fields[{name1}]` | `first_name` | VARCHAR(128) | First non-email |
| `line_item.meta_data[key='_ticket_data'][i].fields[{name2}]` | `last_name` | VARCHAR(128) | Second non-email |

---

## 🚨 CRITICAL MISUNDERSTANDINGS TO AVOID

### **❌ WRONG: "uid is the ticket ID"**
```javascript
// This creates wrong ticket IDs!
ticketId: uid  // "6957f31620aba_0"
```

### **✅ CORRECT: "Look up ticket ID by uid"**
```javascript
const ticketIdMeta = lineItem.meta_data?.find(
  m => m.key === `_ticket_id_for_${uid}`
);
const ticketId = ticketIdMeta?.value;  // "18228" - i dont understand this point - make sure is best practices in terms of the links between data points and using the correct field
```

---

### **❌ WRONG: "Purchase date = event date"**
```javascript
// This assumes tickets bought on event day!
eventDate: order.date_created
```

### **✅ CORRECT: "Event date from product meta"**
```javascript
const eventDateMeta = product.meta_data?.find(m => m.key === 'event_date');
const eventDate = parseDate(eventDateMeta.value);  // "20260125" → Date
```

---

### **❌ WRONG: "Database is source of truth for dates"**
Many events have wrong dates in DB. WooCommerce `meta_data.event_date` is the source of truth.

---

### **❌ WRONG: "Attendee = Booker"**
No! One person (booker) can buy tickets for multiple people (attendees).

```
Booker:    order.billing.* → booker_*
Attendee:  _ticket_data.fields → first_name, last_name, email
```

---

## 🔧 HOW THE FIX SCRIPTS WORK

### **`sync-fix-complete.mjs`**
1. For each event:
   - Fetch product from WC (get event details)
   - Fetch all orders for that product (no date filter!)
   - Extract tickets using CORRECT logic (_ticket_id_for_{uid})
   - In CLEAN mode: Delete all existing, insert fresh
   - In ADDITIVE mode: Skip existing, add missing
   - Verify count after insert

### **`validate-event-dates.mjs`**
1. For each event:
   - Fetch product from WC
   - Find `meta_data.event_date`
   - Parse YYYYMMDD → Date
   - Compare with `tablecn_events.event_date`
   - Report discrepancies
   - In FIX mode: Update database to match WC

---

## ❓ QUESTIONS TO ANSWER
another issue - merging users manually is good but the count of how many users afterwards is not good (count like 3 instead of 1) plus work on the how editing is saved because there's a lag now (maybe can be solved with a store or something before db is updated)
another major issue - a lot of the db enteries in the community memeber list have first name "first name" and family name "family name" - make sure the fetched and handled data is not currpot - 

### **UI Display Issues:**
1. Which specific columns are you not seeing? - source is missing and also ticket column doesnt do anything - and scroll toggle is there for smaller screen in case responsiveness is not good enough. 
2. Which page/component is not showing data? (Check-in page? Members list?) - show the data but not accurate data - should review make sure the scripts and the app logic is good then proper fetch all data in an organized clean way  (with backup)
3. Does a hard refresh (Ctrl+Shift+R) show the data? - no but multiple sync make duplications
4. Are you checking the correct event? yes

### **Date Issues:**
5. How were event dates originally set in the database? - set manually 
6. Should we trust WooCommerce `event_date` meta 100%? yes woocommerce is our source of truth
7. Are there events where the date is intentionally different from WooCommerce? no

### **Sync Behavior:**
8. Should past events EVER re-sync from WooCommerce? - only now then when we finally have the correct data - no further need
9. What happens to manually added attendees during CLEAN sync? - this wont happen
10. Should the UI auto-refresh after a sync? - what does it mean - the ui should present the proper data

---

## 📚 FILES REFERENCE

### **Database Schema**
- `src/db/schema.ts` - Table definitions
- `src/db/utils.ts` - Database helpers

### **WooCommerce Integration**
- `src/lib/woocommerce.ts` - API client & fetching
- `src/lib/sync-attendees.ts` - Sync logic
- `src/lib/cache-utils.ts` - Caching layer

### **UI Components**
- `src/app/page.tsx` - Main check-in page
- `src/app/components/check-in-page.tsx` - Check-in UI
- `src/app/components/check-in-table-grouped.tsx` - Attendee table
- `src/app/community-members-list/` - Members list

### **Server Actions**
- `src/app/actions.ts` - Data fetching & mutations

### **Fix Scripts**
- `sync-fix-complete.mjs` - Complete ticket data fix
- `sync-single-event.mjs` - Test on one event
- `validate-event-dates.mjs` - Fix event dates
- `list-all-events.mjs` - Export event list

---

## ✅ VALIDATION CHECKLIST

To verify data is correct:

```sql
-- 1. Event has correct date
SELECT
  e.name,
  e.event_date as db_date,
  -- Compare with WC meta_data.event_date
FROM tablecn_events e
WHERE e.id = '<event_id>';

-- 2. Tickets have correct IDs (numeric)
SELECT ticket_id
FROM tablecn_attendees
WHERE event_id = '<event_id>'
  AND ticket_id NOT LIKE '%_%';  -- Should return 0 if all correct

-- 3. No duplicates
SELECT ticket_id, COUNT(*)
FROM tablecn_attendees
WHERE event_id = '<event_id>'
GROUP BY ticket_id
HAVING COUNT(*) > 1;  -- Should return 0

-- 4. Count matches WooCommerce
SELECT COUNT(*) FROM tablecn_attendees WHERE event_id = '<event_id>';
-- Compare with WooCommerce order count
```

---

based on my questions and comments in this documents pleas analyse the app and the script structure and fix best practices these issues - be comprehensive and play safe! type safe and dont break anything but make the current setup work good also make the sync script optimized note that woocommerce doenst support concurrency 
