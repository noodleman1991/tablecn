# Event Check-In UI for WooCommerce

A system that tracks events and attendance for the Kairos London community.
It syncs ticket data from WooCommerce, handles check-ins at events, calculates
who qualifies as an active community member, and keeps the email list in sync.

## How It Works

### Events
- Events are discovered automatically from WooCommerce products (hourly cron)
- Each event maps to a WooCommerce product
- Sometimes the same event has multiple products (members-only link,
  additional booking link when the first sells out) — these get merged
  into one event automatically

### Event Merging Rules

**Events that DO get merged (same date required):**
- A regular product + its "members only" variant → merged
- A regular product + an "additional booking link" → merged (90%+ name similarity)

**Events that NEVER merge** (recurring series where each instance is different):
- Sunday Reading Room
- Friday Drinks
- Book Club
- Movie Nights
- Sewing Club
- Open Projects Night
- Workshops
- Screenings
- Lunchtime Video

### Attendance
- Attendees are synced from WooCommerce orders per event
- Each ticket purchaser becomes an attendee record
- Check-in happens manually at the event (UI toggle)
- Only checked-in attendees count toward membership

### Community Membership Calculation
Someone becomes an **active member** when:
1. They've attended (checked in at) **3 or more events total** (all-time)
2. **AND** at least 1 of those events was in the **last 9 months**

Membership expires 9 months after their last qualifying event.

**Events excluded from the count** (social/casual events):
- Walks, parties, drinks
- Seasonal celebrations (e.g. "Winter Celebration", "Summer Party")

Members can also be added manually with a custom expiry date.

### Email Sync
Active member status syncs to Loops.so for the email newsletter list.
Weekly full sync runs Sundays at 6am UTC.

## Tech Stack
- Next.js (App Router)
- PostgreSQL + Drizzle ORM
- WooCommerce REST API (ticket/order source)
- Loops.so (email marketing sync)
- Stack.com (authentication)
- Vercel (hosting + cron)

## Running Locally
1. Clone and install: `pnpm install`
2. Copy `.env.example` to `.env` and fill in credentials
3. Start Postgres: `pnpm db:start` (Docker) or use your own
4. Set up schema: `pnpm db:setup`
5. Run: `pnpm dev`

## Cron Jobs (Vercel)
| Job | Schedule | What it does |
|-----|----------|-------------|
| discover-events | Hourly | Finds new events in WooCommerce, runs merge |
| recalculate-memberships | Hourly | Recalculates membership for recently ended events |
| send-email-reminders | Daily 9am UTC | Sends event reminders |
| cleanup-cache | Every 6 hours | Clears stale cache entries |
| weekly-membership-sync | Sundays 6am UTC | Full membership sync to Loops.so |
