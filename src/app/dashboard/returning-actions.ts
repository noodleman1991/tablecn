"use server";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { attendees, events, members } from "@/db/schema";
import type {
  AttendeeHistoryEntry,
  CohortRow,
  PeriodFilter,
  ReturningMode,
  SuperAttendee,
} from "./types";

function periodDates(period: PeriodFilter) {
  const from =
    period.from instanceof Date ? period.from : new Date(period.from);
  const to = period.to instanceof Date ? period.to : new Date(period.to);
  return { from, to };
}

function isoDate(d: Date): string {
  return d.toISOString();
}

/**
 * Shared CTE used by all returning-attendee queries. Guarantees identical
 * cohort assignment across every chart — changing the definition here changes
 * it everywhere.
 *
 * Cohort rules (per event, per email):
 *  - new       = email's first qualifying event date == current event date
 *  - community = email's first date < current AND member.is_active_member
 *  - returning = email's first date < current AND NOT community
 */
function returningBaseCTE(from: Date, to: Date, mode: ReturningMode) {
  // Attendance mode additionally requires checked_in = true (matches historical
  // dashboard semantics). Purchase mode drops it — "first date" = first valid
  // order date, regardless of check-in.
  const checkedInFilter =
    mode === "attendance" ? sql`AND a.checked_in = true` : sql``;

  return sql`
    WITH first_events AS (
      SELECT LOWER(a.email) AS email, MIN(e.event_date) AS first_date
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE e.merged_into_event_id IS NULL
        AND a.order_status NOT IN ('cancelled','refunded','deleted','failed')
        AND a.email IS NOT NULL AND a.email != ''
        ${checkedInFilter}
      GROUP BY LOWER(a.email)
    ),
    base AS (
      SELECT
        e.id AS event_id,
        e.name AS event_name,
        e.event_date,
        LOWER(a.email) AS email,
        CASE
          WHEN fe.first_date = e.event_date THEN 'new'
          WHEN m.is_active_member = true    THEN 'community'
          ELSE 'returning'
        END AS cohort
      FROM ${events} e
      LEFT JOIN ${attendees} a ON a.event_id = e.id
        AND a.order_status NOT IN ('cancelled','refunded','deleted','failed')
        AND a.email IS NOT NULL AND a.email != ''
        ${checkedInFilter}
      LEFT JOIN first_events fe ON fe.email = LOWER(a.email)
      LEFT JOIN ${members} m ON LOWER(m.email) = LOWER(a.email)
      WHERE e.event_date >= ${isoDate(from)}
        AND e.event_date <= ${isoDate(to)}
        AND e.merged_into_event_id IS NULL
    )
  `;
}

/** Apply runtime invariant: new + returning + community must equal total. */
function assertCohortInvariant(row: CohortRow): CohortRow {
  const sum = row.newCount + row.returningCount + row.communityCount;
  if (sum !== row.totalCount) {
    console.warn(
      `[returning] Cohort sum mismatch: bucket=${row.bucket} ` +
        `sum=${sum} total=${row.totalCount} ` +
        `(new=${row.newCount} ret=${row.returningCount} com=${row.communityCount})`,
    );
    return { ...row, hasMismatch: true };
  }
  return row;
}

/**
 * Retention rate / cohort counts per event or per month.
 * Returns one row per bucket with new/returning/community/total counts.
 */
export async function getRetentionRateTrend(
  period: PeriodFilter,
  mode: ReturningMode = "attendance",
  bucket: "event" | "month" = "event",
): Promise<CohortRow[]> {
  const { from, to } = periodDates(period);
  const baseCTE = returningBaseCTE(from, to, mode);

  if (bucket === "event") {
    const rows = await db.execute<{
      event_id: string;
      event_name: string;
      event_date: string;
      new_count: string;
      returning_count: string;
      community_count: string;
      total_count: string;
    }>(sql`
      ${baseCTE}
      SELECT
        event_id,
        event_name,
        event_date::text AS event_date,
        COUNT(DISTINCT email) FILTER (WHERE cohort = 'new')::text AS new_count,
        COUNT(DISTINCT email) FILTER (WHERE cohort = 'returning')::text AS returning_count,
        COUNT(DISTINCT email) FILTER (WHERE cohort = 'community')::text AS community_count,
        COUNT(DISTINCT email)::text AS total_count
      FROM base
      GROUP BY event_id, event_name, event_date
      ORDER BY event_date, event_name
    `);

    return rows.map((r) =>
      assertCohortInvariant({
        bucket: r.event_id,
        bucketLabel: r.event_name,
        newCount: parseInt(r.new_count),
        returningCount: parseInt(r.returning_count),
        communityCount: parseInt(r.community_count),
        totalCount: parseInt(r.total_count),
        hasMismatch: false,
      }),
    );
  }

  // Monthly bucket — first-cohort-per-month rule.
  // Each email gets one cohort per month based on their EARLIEST appearance that
  // month. Guarantees new + returning + community == total (a person can't be
  // both "new in June" and "returning in June" — they get classified once by
  // their first June event).
  const rows = await db.execute<{
    month: string;
    new_count: string;
    returning_count: string;
    community_count: string;
    total_count: string;
  }>(sql`
    ${baseCTE}
    , first_in_month AS (
      SELECT DISTINCT ON (to_char(event_date, 'YYYY-MM'), email)
        to_char(event_date, 'YYYY-MM') AS month,
        email,
        cohort
      FROM base
      WHERE email IS NOT NULL
      ORDER BY to_char(event_date, 'YYYY-MM'), email, event_date
    )
    SELECT
      month,
      COUNT(*) FILTER (WHERE cohort = 'new')::text AS new_count,
      COUNT(*) FILTER (WHERE cohort = 'returning')::text AS returning_count,
      COUNT(*) FILTER (WHERE cohort = 'community')::text AS community_count,
      COUNT(*)::text AS total_count
    FROM first_in_month
    GROUP BY month
    ORDER BY month
  `);

  return rows.map((r) =>
    assertCohortInvariant({
      bucket: r.month,
      bucketLabel: r.month,
      newCount: parseInt(r.new_count),
      returningCount: parseInt(r.returning_count),
      communityCount: parseInt(r.community_count),
      totalCount: parseInt(r.total_count),
      hasMismatch: false,
    }),
  );
}

/** Same shape as retention trend — feeds the "New vs Returning" chart. */
export async function getNewVsReturningEnhanced(
  period: PeriodFilter,
  mode: ReturningMode = "attendance",
  bucket: "event" | "month" = "event",
): Promise<CohortRow[]> {
  // Identical query — they're the same data surfaced in different visualisations.
  // Keeping them as separate exports preserves per-chart caching and makes it
  // easy to diverge later if the chart ever needs extra columns.
  return getRetentionRateTrend(period, mode, bucket);
}

/** Top repeat attendees by distinct checked-in event count. */
export async function getSuperAttendees(
  period: PeriodFilter,
  mode: ReturningMode = "attendance",
  limit: number = 20,
): Promise<SuperAttendee[]> {
  const { from, to } = periodDates(period);
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));

  const checkedInFilter =
    mode === "attendance" ? sql`AND a.checked_in = true` : sql``;

  const rows = await db.execute<{
    email: string;
    first_name: string | null;
    last_name: string | null;
    events_attended: string;
    last_event_date: string;
    is_community_member: boolean;
  }>(sql`
    WITH person_events AS (
      SELECT
        LOWER(a.email) AS email,
        COUNT(DISTINCT e.id) AS events_attended,
        MAX(e.event_date) AS last_event_date,
        (array_agg(a.first_name ORDER BY e.event_date DESC) FILTER (WHERE a.first_name IS NOT NULL))[1] AS first_name,
        (array_agg(a.last_name ORDER BY e.event_date DESC) FILTER (WHERE a.last_name IS NOT NULL))[1] AS last_name
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE e.merged_into_event_id IS NULL
        AND a.order_status NOT IN ('cancelled','refunded','deleted','failed')
        AND a.email IS NOT NULL AND a.email != ''
        AND e.event_date >= ${isoDate(from)}
        AND e.event_date <= ${isoDate(to)}
        ${checkedInFilter}
      GROUP BY LOWER(a.email)
    )
    SELECT
      pe.email,
      pe.first_name,
      pe.last_name,
      pe.events_attended::text,
      pe.last_event_date::text,
      COALESCE(m.is_active_member, false) AS is_community_member
    FROM person_events pe
    LEFT JOIN ${members} m ON LOWER(m.email) = pe.email
    WHERE pe.events_attended >= 2
    ORDER BY pe.events_attended DESC, pe.last_event_date DESC
    LIMIT ${safeLimit}
  `);

  return rows.map((r) => ({
    email: r.email,
    firstName: r.first_name ?? "",
    lastName: r.last_name ?? "",
    eventsAttended: parseInt(r.events_attended),
    lastEventDate: r.last_event_date,
    isCommunityMember: r.is_community_member,
  }));
}

/** Event history for a single attendee. Used by the history popover. */
export async function getAttendeeEventHistory(
  email: string,
): Promise<AttendeeHistoryEntry[]> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return [];

  const rows = await db.execute<{
    event_id: string;
    event_name: string;
    event_date: string;
    checked_in: boolean;
  }>(sql`
    SELECT
      e.id AS event_id,
      e.name AS event_name,
      e.event_date::text AS event_date,
      BOOL_OR(a.checked_in) AS checked_in
    FROM ${attendees} a
    INNER JOIN ${events} e ON e.id = a.event_id
    WHERE LOWER(a.email) = ${normalizedEmail}
      AND e.merged_into_event_id IS NULL
      AND a.order_status NOT IN ('cancelled','refunded','deleted','failed')
    GROUP BY e.id, e.name, e.event_date
    ORDER BY e.event_date DESC
  `);

  return rows.map((r) => ({
    eventId: r.event_id,
    eventName: r.event_name,
    eventDate: r.event_date,
    checkedIn: r.checked_in,
  }));
}
