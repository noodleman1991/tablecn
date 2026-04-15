-- Backfill: mark legacy social/non-qualifying events as non-qualifying.
-- Extends 0008's pattern list with "reading room" (missed originally) and
-- excludes names starting with "Launch " or "Launch:" — those are legitimate
-- launch events that happen to include "Drinks" in the subtitle.
--
-- Pairs with the switch to category-only qualification in
-- extractQualifyingEventAttribute → isQualifyingEventProduct, and with the
-- discover-events cron becoming insert-only for is_qualifying_event so
-- this backfill (and any future manual DB fix) is not overwritten.
UPDATE "tablecn_events"
SET "is_qualifying_event" = false
WHERE "is_qualifying_event" = true
  AND "merged_into_event_id" IS NULL
  AND name NOT ILIKE 'Launch %'
  AND name NOT ILIKE 'Launch:%'
  AND (
    name ILIKE '%walk%'
    OR name ILIKE '%party%'
    OR name ILIKE '%drinks%'
    OR name ILIKE '%reading room%'
    OR (
      (name ILIKE '%winter%' OR name ILIKE '%spring%' OR name ILIKE '%summer%'
       OR name ILIKE '%autumn%' OR name ILIKE '%fall%' OR name ILIKE '%solstice%'
       OR name ILIKE '%equinox%')
      AND name ILIKE '%celebration%'
    )
  );
