-- Add lifecycle status column to events. Default 'active' so every existing
-- row is unchanged. Cancelled = soft-deleted because the WC product moved to
-- draft/trash or was hard-deleted (404). Only upcoming events (event_date >
-- now) are ever auto-cancelled by the discover-events cron; past events
-- remain immutable.
ALTER TABLE "tablecn_events"
  ADD COLUMN IF NOT EXISTS "status" varchar(20) DEFAULT 'active' NOT NULL;
