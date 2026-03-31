ALTER TABLE "tablecn_events" ADD COLUMN "is_qualifying_event" boolean DEFAULT true;

-- Backfill: mark existing social events as non-qualifying for membership
-- These patterns match the isSocialEvent() logic previously hardcoded in calculate-membership.ts
UPDATE "tablecn_events" SET "is_qualifying_event" = false
WHERE name ILIKE '%walk%'
   OR name ILIKE '%party%'
   OR name ILIKE '%drinks%'
   OR (
     (name ILIKE '%winter%' OR name ILIKE '%spring%' OR name ILIKE '%summer%'
      OR name ILIKE '%autumn%' OR name ILIKE '%fall%' OR name ILIKE '%solstice%'
      OR name ILIKE '%equinox%')
     AND name ILIKE '%celebration%'
   );