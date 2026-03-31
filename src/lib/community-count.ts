import { db } from "@/db";
import { attendees, events, members } from "@/db/schema";
import { sql } from "drizzle-orm";

/** Convert a Date to ISO string for use in raw sql`` templates */
function isoDate(d: Date): string {
  return d.toISOString();
}

/**
 * Authoritative community member count, calculated from raw check-in data.
 * Uses the same logic as the dashboard CTE:
 *   raw_checkins → countable_checkins → member_activation → override_members → count
 */
export async function getActiveCommunityMemberCount(
  asOfDate: Date = new Date(),
): Promise<number> {
  const result = await db.execute<{ community_size: string }>(sql`
    WITH raw_checkins AS (
      SELECT DISTINCT ON (LOWER(a.email), e.id)
        LOWER(a.email) AS email,
        e.event_date
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
        AND e.merged_into_event_id IS NULL
        AND e.is_qualifying_event = true
      ORDER BY LOWER(a.email), e.id
    ),
    countable_checkins AS (
      SELECT email, event_date,
        ROW_NUMBER() OVER (
          PARTITION BY email
          ORDER BY event_date
        ) AS event_rank
      FROM raw_checkins
    ),
    member_activation AS (
      SELECT email, MIN(event_date) AS activation_date
      FROM countable_checkins
      WHERE event_rank = 3
      GROUP BY email
    ),
    override_members AS (
      SELECT LOWER(m.email) AS email,
             m.created_at AS activation_date,
             m.manual_expires_at
      FROM ${members} m
      WHERE m.manually_added = true
        AND m.manual_expires_at IS NOT NULL
    )
    SELECT (SELECT COUNT(DISTINCT x.email) FROM (
      SELECT ma.email
      FROM member_activation ma
      WHERE ma.activation_date <= ${isoDate(asOfDate)}::date
        AND (
          SELECT MAX(cc2.event_date)
          FROM countable_checkins cc2
          WHERE cc2.email = ma.email AND cc2.event_date <= ${isoDate(asOfDate)}::date
        ) + INTERVAL '9 months' > ${isoDate(asOfDate)}::date
      UNION
      SELECT om.email
      FROM override_members om
      WHERE om.activation_date <= ${isoDate(asOfDate)}::date
        AND om.manual_expires_at > ${isoDate(asOfDate)}::date
    ) x)::text AS community_size
  `);

  return parseInt((result as any[])[0]?.community_size ?? "0");
}
