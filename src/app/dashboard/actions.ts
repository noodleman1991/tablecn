"use server";

import { db } from "@/db";
import { attendees, events, members, validationResults } from "@/db/schema";
import { eq, and, gte, lte, isNull, isNotNull, sql, desc } from "drizzle-orm";
import type {
  PeriodFilter,
  DashboardStats,
  FunnelEventRow,
  FunnelMonthRow,
  AnalyticsData,
  ValidationCheck,
  ValidationRunResult,
} from "./types";

const INVALID_STATUSES = ["cancelled", "refunded", "deleted"];

function periodDates(period: PeriodFilter) {
  const from = period.from instanceof Date ? period.from : new Date(period.from);
  const to = period.to instanceof Date ? period.to : new Date(period.to);
  return { from, to };
}

/** Convert a Date to ISO string for use in raw sql`` templates (avoids Drizzle locale serialization bug) */
function isoDate(d: Date): string {
  return d.toISOString();
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export async function getDashboardStats(
  period: PeriodFilter,
): Promise<DashboardStats> {
  const { from, to } = periodDates(period);

  const statsRows = await db.execute<{
    events_count: string;
    tickets_count: string;
    valid_tickets: string;
    checked_in_count: string;
    total_revenue: string;
  }>(sql`
    WITH period_events AS (
      SELECT id FROM ${events}
      WHERE ${events.eventDate} >= ${isoDate(from)}
        AND ${events.eventDate} <= ${isoDate(to)}
        AND ${events.mergedIntoEventId} IS NULL
    )
    SELECT
      COUNT(DISTINCT pe.id)::text AS events_count,
      COUNT(a.id)::text AS tickets_count,
      COUNT(a.id) FILTER (WHERE a.order_status NOT IN ('cancelled','refunded','deleted'))::text AS valid_tickets,
      COUNT(a.id) FILTER (WHERE a.checked_in = true AND a.order_status NOT IN ('cancelled','refunded','deleted'))::text AS checked_in_count,
      COALESCE(SUM(a.order_total) FILTER (WHERE a.order_status NOT IN ('cancelled','refunded','deleted')), 0)::text AS total_revenue
    FROM period_events pe
    LEFT JOIN ${attendees} a ON a.event_id = pe.id
  `);

  const row = statsRows[0];
  const eventsCount = parseInt(row?.events_count ?? "0");
  const ticketsCount = parseInt(row?.tickets_count ?? "0");
  const validTickets = parseInt(row?.valid_tickets ?? "0");
  const checkedInCount = parseInt(row?.checked_in_count ?? "0");
  const totalRevenue = parseFloat(row?.total_revenue ?? "0");

  const activeResult = await db
    .select({ count: sql<string>`COUNT(*)::text` })
    .from(members)
    .where(eq(members.isActiveMember, true));
  const communityMembersCount = parseInt(activeResult[0]?.count ?? "0");

  const checkinRate = validTickets > 0 ? (checkedInCount / validTickets) * 100 : 0;

  return {
    eventsCount,
    ticketsCount,
    validTickets,
    checkedInCount,
    checkinRate,
    communityMembersCount,
    totalRevenue,
  };
}

// ─── Funnel ───────────────────────────────────────────────────────────────────

export async function getFunnelByEvent(
  period: PeriodFilter,
): Promise<FunnelEventRow[]> {
  const { from, to } = periodDates(period);

  // Main aggregation
  const mainRows = await db.execute<{
    id: string;
    name: string;
    event_date: string;
    orders_count: string;
    total_tickets: string;
    valid_tickets: string;
    checked_in_count: string;
    revenue: string;
  }>(sql`
    SELECT
      e.id,
      e.name,
      e.event_date,
      COUNT(DISTINCT a.woocommerce_order_id)::text AS orders_count,
      COUNT(a.id)::text AS total_tickets,
      COUNT(a.id) FILTER (WHERE a.order_status NOT IN ('cancelled','refunded','deleted'))::text AS valid_tickets,
      COUNT(a.id) FILTER (WHERE a.checked_in = true AND a.order_status NOT IN ('cancelled','refunded','deleted'))::text AS checked_in_count,
      COALESCE(SUM(a.order_total) FILTER (WHERE a.order_status NOT IN ('cancelled','refunded','deleted')), 0)::text AS revenue
    FROM ${events} e
    LEFT JOIN ${attendees} a ON a.event_id = e.id
    WHERE e.event_date >= ${isoDate(from)}
      AND e.event_date <= ${isoDate(to)}
      AND e.merged_into_event_id IS NULL
    GROUP BY e.id
    ORDER BY e.event_date DESC
  `);

  // Ticket type breakdown
  const ticketRows = await db.execute<{
    event_id: string;
    ticket_type: string;
    cnt: string;
  }>(sql`
    SELECT a.event_id, COALESCE(a.ticket_type, 'Unknown') AS ticket_type, COUNT(*)::text AS cnt
    FROM ${attendees} a
    INNER JOIN ${events} e ON e.id = a.event_id
    WHERE e.event_date >= ${isoDate(from)}
      AND e.event_date <= ${isoDate(to)}
      AND e.merged_into_event_id IS NULL
      AND a.order_status NOT IN ('cancelled','refunded','deleted')
    GROUP BY a.event_id, a.ticket_type
  `);
  const ticketTypeMap = new Map<string, Record<string, number>>();
  for (const tr of ticketRows as any[]) {
    if (!ticketTypeMap.has(tr.event_id)) ticketTypeMap.set(tr.event_id, {});
    ticketTypeMap.get(tr.event_id)![tr.ticket_type] = parseInt(tr.cnt);
  }

  // Returning attendees (checked-in attendees who have an existing member record)
  const returningRows = await db.execute<{
    event_id: string;
    cnt: string;
  }>(sql`
    SELECT a.event_id, COUNT(DISTINCT a.email)::text AS cnt
    FROM ${attendees} a
    INNER JOIN ${members} m ON LOWER(a.email) = LOWER(m.email)
    INNER JOIN ${events} e ON e.id = a.event_id
    WHERE a.checked_in = true
      AND e.event_date >= ${isoDate(from)}
      AND e.event_date <= ${isoDate(to)}
      AND e.merged_into_event_id IS NULL
    GROUP BY a.event_id
  `);
  const returningMap = new Map<string, number>();
  for (const cr of returningRows as any[]) {
    returningMap.set(cr.event_id, parseInt(cr.cnt));
  }

  // New attendees per event (member created within 5min of check-in)
  const newCountRows = await db.execute<{
    event_id: string;
    new_count: string;
  }>(sql`
    SELECT a.event_id, COUNT(DISTINCT m.id)::text AS new_count
    FROM ${attendees} a
    INNER JOIN ${members} m ON LOWER(m.email) = LOWER(a.email)
    INNER JOIN ${events} e ON e.id = a.event_id
    WHERE a.checked_in = true
      AND e.event_date >= ${isoDate(from)} AND e.event_date <= ${isoDate(to)}
      AND e.merged_into_event_id IS NULL
      AND m.created_at >= a.checked_in_at - INTERVAL '5 minutes'
      AND m.created_at <= a.checked_in_at + INTERVAL '5 minutes'
    GROUP BY a.event_id
  `);
  const newCountMap = new Map<string, number>();
  for (const r of newCountRows as any[]) {
    newCountMap.set(r.event_id, parseInt(r.new_count));
  }

  // Community members gained per event: attendees whose 3rd countable event was this event
  const communityGainedRows = await db.execute<{
    event_id: string;
    cnt: string;
  }>(sql`
    WITH raw_checkins AS (
      SELECT DISTINCT ON (LOWER(a.email), e.id)
        LOWER(a.email) AS email,
        e.id AS event_id,
        e.event_date
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
        AND e.merged_into_event_id IS NULL
        AND e.name NOT ILIKE '%walk%'
        AND e.name NOT ILIKE '%party%'
        AND e.name NOT ILIKE '%drinks%'
        AND NOT (
          (e.name ILIKE '%winter%' OR e.name ILIKE '%spring%' OR e.name ILIKE '%summer%'
           OR e.name ILIKE '%autumn%' OR e.name ILIKE '%fall%' OR e.name ILIKE '%solstice%'
           OR e.name ILIKE '%equinox%')
          AND e.name ILIKE '%celebration%'
        )
      ORDER BY LOWER(a.email), e.id
    ),
    countable_checkins AS (
      SELECT email, event_id, event_date,
        ROW_NUMBER() OVER (
          PARTITION BY email
          ORDER BY event_date, event_id
        ) AS event_rank
      FROM raw_checkins
    )
    SELECT cc.event_id, COUNT(DISTINCT cc.email)::text AS cnt
    FROM countable_checkins cc
    INNER JOIN ${events} e ON e.id = cc.event_id
    WHERE cc.event_rank = 3
      AND e.event_date >= ${isoDate(from)} AND e.event_date <= ${isoDate(to)}
    GROUP BY cc.event_id
  `);
  const communityGainedMap = new Map<string, number>();
  for (const cr of communityGainedRows as any[]) {
    communityGainedMap.set(cr.event_id, parseInt(cr.cnt));
  }

  // Community members lost per event: members whose 9-month recency window expired
  // between the previous event and this event (their last countable event + 9 months
  // falls between the previous period event date and this event date)
  const communityLostRows = await db.execute<{
    event_id: string;
    cnt: string;
  }>(sql`
    WITH period_events AS (
      SELECT id, event_date,
        LAG(event_date) OVER (ORDER BY event_date, id) AS prev_event_date
      FROM ${events}
      WHERE event_date >= ${isoDate(from)} AND event_date <= ${isoDate(to)}
        AND merged_into_event_id IS NULL
    ),
    member_last_countable AS (
      SELECT LOWER(a.email) AS email, MAX(e.event_date) AS last_countable_date
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
        AND e.merged_into_event_id IS NULL
        AND e.name NOT ILIKE '%walk%'
        AND e.name NOT ILIKE '%party%'
        AND e.name NOT ILIKE '%drinks%'
        AND NOT (
          (e.name ILIKE '%winter%' OR e.name ILIKE '%spring%' OR e.name ILIKE '%summer%'
           OR e.name ILIKE '%autumn%' OR e.name ILIKE '%fall%' OR e.name ILIKE '%solstice%'
           OR e.name ILIKE '%equinox%')
          AND e.name ILIKE '%celebration%'
        )
      GROUP BY LOWER(a.email)
      HAVING COUNT(DISTINCT e.id) >= 3
    )
    SELECT pe.id AS event_id, COUNT(DISTINCT mlc.email)::text AS cnt
    FROM period_events pe
    INNER JOIN member_last_countable mlc
      ON mlc.last_countable_date + INTERVAL '9 months' > COALESCE(pe.prev_event_date, ${isoDate(from)}::date - INTERVAL '1 day')
      AND mlc.last_countable_date + INTERVAL '9 months' <= pe.event_date
    GROUP BY pe.id
  `);
  const communityLostMap = new Map<string, number>();
  for (const cr of communityLostRows as any[]) {
    communityLostMap.set(cr.event_id, parseInt(cr.cnt));
  }

  return (mainRows as any[]).map((r) => {
    const validTickets = parseInt(r.valid_tickets);
    const checkedInCount = parseInt(r.checked_in_count);
    return {
      eventId: r.id,
      eventName: r.name,
      eventDate: new Date(r.event_date),
      ordersCount: parseInt(r.orders_count),
      ticketBreakdown: ticketTypeMap.get(r.id) || {},
      totalTickets: parseInt(r.total_tickets),
      validTickets,
      checkedInCount,
      checkedInPercent: validTickets > 0 ? Math.round((checkedInCount / validTickets) * 100) : 0,
      returningCount: returningMap.get(r.id) || 0,
      communityGained: communityGainedMap.get(r.id) || 0,
      communityLost: communityLostMap.get(r.id) || 0,
      newCount: newCountMap.get(r.id) || 0,
      revenue: parseFloat(r.revenue),
    };
  });
}

export async function getFunnelByMonth(
  period: PeriodFilter,
): Promise<FunnelMonthRow[]> {
  const { from, to } = periodDates(period);

  const mainRows = await db.execute<{
    month: string;
    events_count: string;
    orders_count: string;
    total_tickets: string;
    valid_tickets: string;
    checked_in_count: string;
    revenue: string;
  }>(sql`
    SELECT
      TO_CHAR(e.event_date, 'YYYY-MM') AS month,
      COUNT(DISTINCT e.id)::text AS events_count,
      COUNT(DISTINCT a.woocommerce_order_id)::text AS orders_count,
      COUNT(a.id)::text AS total_tickets,
      COUNT(a.id) FILTER (WHERE a.order_status NOT IN ('cancelled','refunded','deleted'))::text AS valid_tickets,
      COUNT(a.id) FILTER (WHERE a.checked_in = true AND a.order_status NOT IN ('cancelled','refunded','deleted'))::text AS checked_in_count,
      COALESCE(SUM(a.order_total) FILTER (WHERE a.order_status NOT IN ('cancelled','refunded','deleted')), 0)::text AS revenue
    FROM ${events} e
    LEFT JOIN ${attendees} a ON a.event_id = e.id
    WHERE e.event_date >= ${isoDate(from)}
      AND e.event_date <= ${isoDate(to)}
      AND e.merged_into_event_id IS NULL
    GROUP BY TO_CHAR(e.event_date, 'YYYY-MM')
    ORDER BY month DESC
  `);

  // Ticket type breakdown by month
  const ticketRows = await db.execute<{
    month: string;
    ticket_type: string;
    cnt: string;
  }>(sql`
    SELECT
      TO_CHAR(e.event_date, 'YYYY-MM') AS month,
      COALESCE(a.ticket_type, 'Unknown') AS ticket_type,
      COUNT(*)::text AS cnt
    FROM ${attendees} a
    INNER JOIN ${events} e ON e.id = a.event_id
    WHERE e.event_date >= ${isoDate(from)}
      AND e.event_date <= ${isoDate(to)}
      AND e.merged_into_event_id IS NULL
      AND a.order_status NOT IN ('cancelled','refunded','deleted')
    GROUP BY TO_CHAR(e.event_date, 'YYYY-MM'), a.ticket_type
  `);
  const ticketTypeMap = new Map<string, Record<string, number>>();
  for (const tr of ticketRows as any[]) {
    if (!ticketTypeMap.has(tr.month)) ticketTypeMap.set(tr.month, {});
    ticketTypeMap.get(tr.month)![tr.ticket_type] = parseInt(tr.cnt);
  }

  // Returning attendees by month
  const returningMonthRows = await db.execute<{
    month: string;
    cnt: string;
  }>(sql`
    SELECT
      TO_CHAR(e.event_date, 'YYYY-MM') AS month,
      COUNT(DISTINCT a.email)::text AS cnt
    FROM ${attendees} a
    INNER JOIN ${members} m ON LOWER(a.email) = LOWER(m.email)
    INNER JOIN ${events} e ON e.id = a.event_id
    WHERE a.checked_in = true
      AND e.event_date >= ${isoDate(from)}
      AND e.event_date <= ${isoDate(to)}
      AND e.merged_into_event_id IS NULL
    GROUP BY TO_CHAR(e.event_date, 'YYYY-MM')
  `);
  const returningMonthMap = new Map<string, number>();
  for (const cr of returningMonthRows as any[]) {
    returningMonthMap.set(cr.month, parseInt(cr.cnt));
  }

  // New attendees by month (member created within 5min of check-in)
  const newCountMonthRows = await db.execute<{
    month: string;
    new_count: string;
  }>(sql`
    SELECT
      TO_CHAR(e.event_date, 'YYYY-MM') AS month,
      COUNT(DISTINCT m.id)::text AS new_count
    FROM ${attendees} a
    INNER JOIN ${members} m ON LOWER(m.email) = LOWER(a.email)
    INNER JOIN ${events} e ON e.id = a.event_id
    WHERE a.checked_in = true
      AND e.event_date >= ${isoDate(from)} AND e.event_date <= ${isoDate(to)}
      AND e.merged_into_event_id IS NULL
      AND m.created_at >= a.checked_in_at - INTERVAL '5 minutes'
      AND m.created_at <= a.checked_in_at + INTERVAL '5 minutes'
    GROUP BY TO_CHAR(e.event_date, 'YYYY-MM')
  `);
  const newCountMonthMap = new Map<string, number>();
  for (const r of newCountMonthRows as any[]) {
    newCountMonthMap.set(r.month, parseInt(r.new_count));
  }

  // Community members gained by month: attendees whose 3rd countable event fell in that month
  const communityGainedMonthRows = await db.execute<{
    month: string;
    cnt: string;
  }>(sql`
    WITH raw_checkins AS (
      SELECT DISTINCT ON (LOWER(a.email), e.id)
        LOWER(a.email) AS email,
        e.id AS event_id,
        e.event_date
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
        AND e.merged_into_event_id IS NULL
        AND e.name NOT ILIKE '%walk%'
        AND e.name NOT ILIKE '%party%'
        AND e.name NOT ILIKE '%drinks%'
        AND NOT (
          (e.name ILIKE '%winter%' OR e.name ILIKE '%spring%' OR e.name ILIKE '%summer%'
           OR e.name ILIKE '%autumn%' OR e.name ILIKE '%fall%' OR e.name ILIKE '%solstice%'
           OR e.name ILIKE '%equinox%')
          AND e.name ILIKE '%celebration%'
        )
      ORDER BY LOWER(a.email), e.id
    ),
    countable_checkins AS (
      SELECT email, event_id, event_date,
        ROW_NUMBER() OVER (
          PARTITION BY email
          ORDER BY event_date, event_id
        ) AS event_rank
      FROM raw_checkins
    )
    SELECT TO_CHAR(cc.event_date, 'YYYY-MM') AS month, COUNT(DISTINCT cc.email)::text AS cnt
    FROM countable_checkins cc
    WHERE cc.event_rank = 3
      AND cc.event_date >= ${isoDate(from)} AND cc.event_date <= ${isoDate(to)}
    GROUP BY TO_CHAR(cc.event_date, 'YYYY-MM')
  `);
  const communityGainedMonthMap = new Map<string, number>();
  for (const cr of communityGainedMonthRows as any[]) {
    communityGainedMonthMap.set(cr.month, parseInt(cr.cnt));
  }

  // Community members lost by month: members whose 9-month recency expired in that month
  const communityLostMonthRows = await db.execute<{
    month: string;
    cnt: string;
  }>(sql`
    WITH member_last_countable AS (
      SELECT LOWER(a.email) AS email, MAX(e.event_date) AS last_countable_date
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
        AND e.merged_into_event_id IS NULL
        AND e.name NOT ILIKE '%walk%'
        AND e.name NOT ILIKE '%party%'
        AND e.name NOT ILIKE '%drinks%'
        AND NOT (
          (e.name ILIKE '%winter%' OR e.name ILIKE '%spring%' OR e.name ILIKE '%summer%'
           OR e.name ILIKE '%autumn%' OR e.name ILIKE '%fall%' OR e.name ILIKE '%solstice%'
           OR e.name ILIKE '%equinox%')
          AND e.name ILIKE '%celebration%'
        )
      GROUP BY LOWER(a.email)
      HAVING COUNT(DISTINCT e.id) >= 3
    )
    SELECT
      TO_CHAR(mlc.last_countable_date + INTERVAL '9 months', 'YYYY-MM') AS month,
      COUNT(DISTINCT mlc.email)::text AS cnt
    FROM member_last_countable mlc
    WHERE mlc.last_countable_date + INTERVAL '9 months' >= ${isoDate(from)}::date
      AND mlc.last_countable_date + INTERVAL '9 months' <= ${isoDate(to)}::date
    GROUP BY TO_CHAR(mlc.last_countable_date + INTERVAL '9 months', 'YYYY-MM')
  `);
  const communityLostMonthMap = new Map<string, number>();
  for (const cr of communityLostMonthRows as any[]) {
    communityLostMonthMap.set(cr.month, parseInt(cr.cnt));
  }

  return (mainRows as any[]).map((r) => {
    const validTickets = parseInt(r.valid_tickets);
    const checkedInCount = parseInt(r.checked_in_count);
    return {
      month: r.month,
      eventsCount: parseInt(r.events_count),
      ordersCount: parseInt(r.orders_count),
      ticketBreakdown: ticketTypeMap.get(r.month) || {},
      totalTickets: parseInt(r.total_tickets),
      validTickets,
      checkedInCount,
      checkedInPercent: validTickets > 0 ? Math.round((checkedInCount / validTickets) * 100) : 0,
      returningCount: returningMonthMap.get(r.month) || 0,
      communityGained: communityGainedMonthMap.get(r.month) || 0,
      communityLost: communityLostMonthMap.get(r.month) || 0,
      newCount: newCountMonthMap.get(r.month) || 0,
      revenue: parseFloat(r.revenue),
    };
  });
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export async function getAnalyticsData(
  period: PeriodFilter,
): Promise<AnalyticsData> {
  const { from, to } = periodDates(period);

  // Attendance trend
  const attendanceTrendRows = await db.execute<{
    name: string;
    event_date: string;
    cnt: string;
  }>(sql`
    SELECT e.name, e.event_date::text,
      COUNT(a.id) FILTER (WHERE a.checked_in = true AND a.order_status NOT IN ('cancelled','refunded','deleted'))::text AS cnt
    FROM ${events} e
    LEFT JOIN ${attendees} a ON a.event_id = e.id
    WHERE e.event_date >= ${isoDate(from)} AND e.event_date <= ${isoDate(to)}
      AND e.merged_into_event_id IS NULL
    GROUP BY e.id, e.name, e.event_date
    ORDER BY e.event_date
  `);

  // Ticket type distribution
  const ticketTypeRows = await db.execute<{
    ticket_type: string;
    cnt: string;
  }>(sql`
    SELECT COALESCE(a.ticket_type, 'Unknown') AS ticket_type, COUNT(*)::text AS cnt
    FROM ${attendees} a
    INNER JOIN ${events} e ON e.id = a.event_id
    WHERE e.event_date >= ${isoDate(from)} AND e.event_date <= ${isoDate(to)}
      AND e.merged_into_event_id IS NULL
      AND a.order_status NOT IN ('cancelled','refunded','deleted')
    GROUP BY a.ticket_type
    ORDER BY COUNT(*) DESC
  `);

  // Revenue trend
  const revenueTrendRows = await db.execute<{
    month: string;
    revenue: string;
  }>(sql`
    SELECT TO_CHAR(e.event_date, 'YYYY-MM') AS month,
      COALESCE(SUM(a.order_total) FILTER (WHERE a.order_status NOT IN ('cancelled','refunded','deleted')), 0)::text AS revenue
    FROM ${events} e
    LEFT JOIN ${attendees} a ON a.event_id = e.id
    WHERE e.event_date >= ${isoDate(from)} AND e.event_date <= ${isoDate(to)}
      AND e.merged_into_event_id IS NULL
    GROUP BY TO_CHAR(e.event_date, 'YYYY-MM')
    ORDER BY month
  `);

  // Top events
  const topEventsRows = await db.execute<{
    name: string;
    event_date: string;
    cnt: string;
  }>(sql`
    SELECT e.name, e.event_date::text,
      COUNT(a.id) FILTER (WHERE a.checked_in = true AND a.order_status NOT IN ('cancelled','refunded','deleted'))::text AS cnt
    FROM ${events} e
    LEFT JOIN ${attendees} a ON a.event_id = e.id
    WHERE e.event_date >= ${isoDate(from)} AND e.event_date <= ${isoDate(to)}
      AND e.merged_into_event_id IS NULL
    GROUP BY e.id, e.name, e.event_date
    ORDER BY COUNT(a.id) FILTER (WHERE a.checked_in = true AND a.order_status NOT IN ('cancelled','refunded','deleted')) DESC
    LIMIT 10
  `);

  // Top buyers
  const topBuyersRows = await db.execute<{
    email: string;
    name: string;
    cnt: string;
  }>(sql`
    SELECT a.booker_email AS email,
      CONCAT(MAX(a.booker_first_name), ' ', MAX(a.booker_last_name)) AS name,
      COUNT(DISTINCT a.woocommerce_order_id)::text AS cnt
    FROM ${attendees} a
    INNER JOIN ${events} e ON e.id = a.event_id
    WHERE e.event_date >= ${isoDate(from)} AND e.event_date <= ${isoDate(to)}
      AND e.merged_into_event_id IS NULL
      AND a.order_status NOT IN ('cancelled','refunded','deleted')
      AND a.booker_email IS NOT NULL AND a.booker_email != ''
    GROUP BY a.booker_email
    ORDER BY COUNT(DISTINCT a.woocommerce_order_id) DESC
    LIMIT 10
  `);

  // New vs returning
  const newVsReturningRows = await db.execute<{
    name: string;
    event_date: string;
    new_count: string;
    returning_count: string;
  }>(sql`
    WITH first_events AS (
      SELECT a.email, MIN(e.event_date) AS first_date
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
        AND e.merged_into_event_id IS NULL
      GROUP BY a.email
    )
    SELECT e.name, e.event_date::text,
      COUNT(DISTINCT a.email) FILTER (WHERE fe.first_date = e.event_date)::text AS new_count,
      COUNT(DISTINCT a.email) FILTER (WHERE fe.first_date < e.event_date)::text AS returning_count
    FROM ${events} e
    LEFT JOIN ${attendees} a ON a.event_id = e.id
      AND a.checked_in = true
      AND a.order_status NOT IN ('cancelled','refunded','deleted')
    LEFT JOIN first_events fe ON LOWER(fe.email) = LOWER(a.email)
    WHERE e.event_date >= ${isoDate(from)} AND e.event_date <= ${isoDate(to)}
      AND e.merged_into_event_id IS NULL
    GROUP BY e.id, e.name, e.event_date
    ORDER BY e.event_date
  `);

  // Attendee breakdown per event: new / returning (non-community) / community
  const breakdownByEventRows = await db.execute<{
    name: string;
    event_date: string;
    new_count: string;
    returning_count: string;
    community_count: string;
  }>(sql`
    WITH first_events AS (
      SELECT a.email, MIN(e.event_date) AS first_date
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
        AND e.merged_into_event_id IS NULL
      GROUP BY a.email
    )
    SELECT e.name, e.event_date::text,
      COUNT(DISTINCT a.email) FILTER (WHERE fe.first_date = e.event_date)::text AS new_count,
      COUNT(DISTINCT a.email) FILTER (WHERE fe.first_date < e.event_date AND (m.is_active_member IS NULL OR m.is_active_member = false))::text AS returning_count,
      COUNT(DISTINCT a.email) FILTER (WHERE fe.first_date < e.event_date AND m.is_active_member = true)::text AS community_count
    FROM ${events} e
    LEFT JOIN ${attendees} a ON a.event_id = e.id
      AND a.checked_in = true
      AND a.order_status NOT IN ('cancelled','refunded','deleted')
    LEFT JOIN first_events fe ON LOWER(fe.email) = LOWER(a.email)
    LEFT JOIN ${members} m ON LOWER(m.email) = LOWER(a.email)
    WHERE e.event_date >= ${isoDate(from)} AND e.event_date <= ${isoDate(to)}
      AND e.merged_into_event_id IS NULL
    GROUP BY e.id, e.name, e.event_date
    ORDER BY e.event_date
  `);

  // Community gained per event (3rd countable event)
  const analyticsGainedRows = await db.execute<{
    event_id: string;
    event_date: string;
    cnt: string;
  }>(sql`
    WITH raw_checkins AS (
      SELECT DISTINCT ON (LOWER(a.email), e.id)
        LOWER(a.email) AS email,
        e.id AS event_id,
        e.event_date
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
        AND e.merged_into_event_id IS NULL
        AND e.name NOT ILIKE '%walk%'
        AND e.name NOT ILIKE '%party%'
        AND e.name NOT ILIKE '%drinks%'
        AND NOT (
          (e.name ILIKE '%winter%' OR e.name ILIKE '%spring%' OR e.name ILIKE '%summer%'
           OR e.name ILIKE '%autumn%' OR e.name ILIKE '%fall%' OR e.name ILIKE '%solstice%'
           OR e.name ILIKE '%equinox%')
          AND e.name ILIKE '%celebration%'
        )
      ORDER BY LOWER(a.email), e.id
    ),
    countable_checkins AS (
      SELECT email, event_id, event_date,
        ROW_NUMBER() OVER (
          PARTITION BY email
          ORDER BY event_date, event_id
        ) AS event_rank
      FROM raw_checkins
    )
    SELECT cc.event_id, e.event_date::text, COUNT(DISTINCT cc.email)::text AS cnt
    FROM countable_checkins cc
    INNER JOIN ${events} e ON e.id = cc.event_id
    WHERE cc.event_rank = 3
      AND e.event_date >= ${isoDate(from)} AND e.event_date <= ${isoDate(to)}
    GROUP BY cc.event_id, e.event_date
  `);
  const analyticsGainedMap = new Map<string, number>();
  for (const r of analyticsGainedRows as any[]) {
    const dateKey = r.event_date.split("T")[0] ?? r.event_date;
    analyticsGainedMap.set(dateKey, (analyticsGainedMap.get(dateKey) || 0) + parseInt(r.cnt));
  }

  // Community lost per event
  const analyticsLostRows = await db.execute<{
    event_id: string;
    event_date: string;
    cnt: string;
  }>(sql`
    WITH period_events AS (
      SELECT id, event_date,
        LAG(event_date) OVER (ORDER BY event_date, id) AS prev_event_date
      FROM ${events}
      WHERE event_date >= ${isoDate(from)} AND event_date <= ${isoDate(to)}
        AND merged_into_event_id IS NULL
    ),
    member_last_countable AS (
      SELECT LOWER(a.email) AS email, MAX(e.event_date) AS last_countable_date
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
        AND e.merged_into_event_id IS NULL
        AND e.name NOT ILIKE '%walk%'
        AND e.name NOT ILIKE '%party%'
        AND e.name NOT ILIKE '%drinks%'
        AND NOT (
          (e.name ILIKE '%winter%' OR e.name ILIKE '%spring%' OR e.name ILIKE '%summer%'
           OR e.name ILIKE '%autumn%' OR e.name ILIKE '%fall%' OR e.name ILIKE '%solstice%'
           OR e.name ILIKE '%equinox%')
          AND e.name ILIKE '%celebration%'
        )
      GROUP BY LOWER(a.email)
      HAVING COUNT(DISTINCT e.id) >= 3
    )
    SELECT pe.id AS event_id, pe.event_date::text, COUNT(DISTINCT mlc.email)::text AS cnt
    FROM period_events pe
    INNER JOIN member_last_countable mlc
      ON mlc.last_countable_date + INTERVAL '9 months' > COALESCE(pe.prev_event_date, ${isoDate(from)}::date - INTERVAL '1 day')
      AND mlc.last_countable_date + INTERVAL '9 months' <= pe.event_date
    GROUP BY pe.id, pe.event_date
  `);
  const analyticsLostMap = new Map<string, number>();
  for (const r of analyticsLostRows as any[]) {
    const dateKey = r.event_date.split("T")[0] ?? r.event_date;
    analyticsLostMap.set(dateKey, (analyticsLostMap.get(dateKey) || 0) + parseInt(r.cnt));
  }

  // Point-in-time community size per event date
  const communitySizeByEventRows = await db.execute<{
    event_date: string;
    community_size: string;
  }>(sql`
    WITH raw_checkins AS (
      SELECT DISTINCT ON (LOWER(a.email), e.id)
        LOWER(a.email) AS email,
        e.event_date,
        e.id AS event_id
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
        AND e.merged_into_event_id IS NULL
        AND e.name NOT ILIKE '%walk%'
        AND e.name NOT ILIKE '%party%'
        AND e.name NOT ILIKE '%drinks%'
        AND NOT (
          (e.name ILIKE '%winter%' OR e.name ILIKE '%spring%' OR e.name ILIKE '%summer%'
           OR e.name ILIKE '%autumn%' OR e.name ILIKE '%fall%' OR e.name ILIKE '%solstice%'
           OR e.name ILIKE '%equinox%')
          AND e.name ILIKE '%celebration%'
        )
      ORDER BY LOWER(a.email), e.id
    ),
    countable_checkins AS (
      SELECT email, event_date, event_id,
        ROW_NUMBER() OVER (
          PARTITION BY email
          ORDER BY event_date, event_id
        ) AS event_rank
      FROM raw_checkins
    ),
    member_activation AS (
      SELECT email, MIN(event_date) AS activation_date
      FROM countable_checkins
      WHERE event_rank = 3
      GROUP BY email
    ),
    period_events AS (
      SELECT id, name, event_date
      FROM ${events}
      WHERE event_date >= ${isoDate(from)} AND event_date <= ${isoDate(to)}
        AND merged_into_event_id IS NULL
      ORDER BY event_date
    )
    SELECT pe.event_date::text,
      COUNT(DISTINCT ma.email)::text AS community_size
    FROM period_events pe
    CROSS JOIN member_activation ma
    WHERE ma.activation_date <= pe.event_date
      AND (
        SELECT MAX(cc2.event_date)
        FROM countable_checkins cc2
        WHERE cc2.email = ma.email AND cc2.event_date <= pe.event_date
      ) + INTERVAL '9 months' > pe.event_date
    GROUP BY pe.event_date
    ORDER BY pe.event_date
  `);
  const communitySizeByEventMap = new Map<string, number>();
  for (const r of communitySizeByEventRows as any[]) {
    const dateKey = r.event_date.split("T")[0] ?? r.event_date;
    communitySizeByEventMap.set(dateKey, parseInt(r.community_size));
  }

  // Build by-event breakdown with point-in-time community size
  const byEventData = (breakdownByEventRows as any[]).map((r) => {
    const date = r.event_date.split("T")[0] ?? r.event_date;
    return {
      eventName: r.name as string,
      date,
      newCount: parseInt(r.new_count),
      returningCount: parseInt(r.returning_count),
      communityCount: parseInt(r.community_count),
      communityGained: analyticsGainedMap.get(date) || 0,
      communityLost: analyticsLostMap.get(date) || 0,
      cumulativeCommunity: communitySizeByEventMap.get(date) || 0,
    };
  });

  // Attendee breakdown by month
  const breakdownByMonthRows = await db.execute<{
    month: string;
    new_count: string;
    returning_count: string;
    community_count: string;
  }>(sql`
    WITH first_events AS (
      SELECT a.email, MIN(e.event_date) AS first_date
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
        AND e.merged_into_event_id IS NULL
      GROUP BY a.email
    )
    SELECT TO_CHAR(e.event_date, 'YYYY-MM') AS month,
      COUNT(DISTINCT a.email) FILTER (WHERE fe.first_date = e.event_date)::text AS new_count,
      COUNT(DISTINCT a.email) FILTER (WHERE fe.first_date < e.event_date AND (m.is_active_member IS NULL OR m.is_active_member = false))::text AS returning_count,
      COUNT(DISTINCT a.email) FILTER (WHERE fe.first_date < e.event_date AND m.is_active_member = true)::text AS community_count
    FROM ${events} e
    LEFT JOIN ${attendees} a ON a.event_id = e.id
      AND a.checked_in = true
      AND a.order_status NOT IN ('cancelled','refunded','deleted')
    LEFT JOIN first_events fe ON LOWER(fe.email) = LOWER(a.email)
    LEFT JOIN ${members} m ON LOWER(m.email) = LOWER(a.email)
    WHERE e.event_date >= ${isoDate(from)} AND e.event_date <= ${isoDate(to)}
      AND e.merged_into_event_id IS NULL
    GROUP BY TO_CHAR(e.event_date, 'YYYY-MM')
    ORDER BY month
  `);

  // Community gained by month
  const analyticsGainedMonthRows = await db.execute<{
    month: string;
    cnt: string;
  }>(sql`
    WITH raw_checkins AS (
      SELECT DISTINCT ON (LOWER(a.email), e.id)
        LOWER(a.email) AS email,
        e.id AS event_id,
        e.event_date
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
        AND e.merged_into_event_id IS NULL
        AND e.name NOT ILIKE '%walk%'
        AND e.name NOT ILIKE '%party%'
        AND e.name NOT ILIKE '%drinks%'
        AND NOT (
          (e.name ILIKE '%winter%' OR e.name ILIKE '%spring%' OR e.name ILIKE '%summer%'
           OR e.name ILIKE '%autumn%' OR e.name ILIKE '%fall%' OR e.name ILIKE '%solstice%'
           OR e.name ILIKE '%equinox%')
          AND e.name ILIKE '%celebration%'
        )
      ORDER BY LOWER(a.email), e.id
    ),
    countable_checkins AS (
      SELECT email, event_id, event_date,
        ROW_NUMBER() OVER (
          PARTITION BY email
          ORDER BY event_date, event_id
        ) AS event_rank
      FROM raw_checkins
    )
    SELECT TO_CHAR(cc.event_date, 'YYYY-MM') AS month, COUNT(DISTINCT cc.email)::text AS cnt
    FROM countable_checkins cc
    WHERE cc.event_rank = 3
      AND cc.event_date >= ${isoDate(from)} AND cc.event_date <= ${isoDate(to)}
    GROUP BY TO_CHAR(cc.event_date, 'YYYY-MM')
  `);
  const analyticsGainedMonthMap = new Map<string, number>();
  for (const r of analyticsGainedMonthRows as any[]) {
    analyticsGainedMonthMap.set(r.month, parseInt(r.cnt));
  }

  // Community lost by month (kept for tooltip display)
  const analyticsLostMonthRows = await db.execute<{
    month: string;
    cnt: string;
  }>(sql`
    WITH member_last_countable AS (
      SELECT LOWER(a.email) AS email, MAX(e.event_date) AS last_countable_date
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
        AND e.merged_into_event_id IS NULL
        AND e.name NOT ILIKE '%walk%'
        AND e.name NOT ILIKE '%party%'
        AND e.name NOT ILIKE '%drinks%'
        AND NOT (
          (e.name ILIKE '%winter%' OR e.name ILIKE '%spring%' OR e.name ILIKE '%summer%'
           OR e.name ILIKE '%autumn%' OR e.name ILIKE '%fall%' OR e.name ILIKE '%solstice%'
           OR e.name ILIKE '%equinox%')
          AND e.name ILIKE '%celebration%'
        )
      GROUP BY LOWER(a.email)
      HAVING COUNT(DISTINCT e.id) >= 3
    )
    SELECT
      TO_CHAR(mlc.last_countable_date + INTERVAL '9 months', 'YYYY-MM') AS month,
      COUNT(DISTINCT mlc.email)::text AS cnt
    FROM member_last_countable mlc
    WHERE mlc.last_countable_date + INTERVAL '9 months' >= ${isoDate(from)}::date
      AND mlc.last_countable_date + INTERVAL '9 months' <= ${isoDate(to)}::date
    GROUP BY TO_CHAR(mlc.last_countable_date + INTERVAL '9 months', 'YYYY-MM')
  `);
  const analyticsLostMonthMap = new Map<string, number>();
  for (const r of analyticsLostMonthRows as any[]) {
    analyticsLostMonthMap.set(r.month, parseInt(r.cnt));
  }

  // Point-in-time community size per month (last day of each month)
  const communitySizeByMonthRows = await db.execute<{
    month: string;
    community_size: string;
  }>(sql`
    WITH raw_checkins AS (
      SELECT DISTINCT ON (LOWER(a.email), e.id)
        LOWER(a.email) AS email,
        e.event_date,
        e.id AS event_id
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
        AND e.merged_into_event_id IS NULL
        AND e.name NOT ILIKE '%walk%'
        AND e.name NOT ILIKE '%party%'
        AND e.name NOT ILIKE '%drinks%'
        AND NOT (
          (e.name ILIKE '%winter%' OR e.name ILIKE '%spring%' OR e.name ILIKE '%summer%'
           OR e.name ILIKE '%autumn%' OR e.name ILIKE '%fall%' OR e.name ILIKE '%solstice%'
           OR e.name ILIKE '%equinox%')
          AND e.name ILIKE '%celebration%'
        )
      ORDER BY LOWER(a.email), e.id
    ),
    countable_checkins AS (
      SELECT email, event_date, event_id,
        ROW_NUMBER() OVER (
          PARTITION BY email
          ORDER BY event_date, event_id
        ) AS event_rank
      FROM raw_checkins
    ),
    member_activation AS (
      SELECT email, MIN(event_date) AS activation_date
      FROM countable_checkins
      WHERE event_rank = 3
      GROUP BY email
    ),
    period_months AS (
      SELECT TO_CHAR(gs, 'YYYY-MM') AS month,
        (gs + INTERVAL '1 month' - INTERVAL '1 day')::date AS month_end
      FROM generate_series(
        DATE_TRUNC('month', ${isoDate(from)}::date),
        DATE_TRUNC('month', ${isoDate(to)}::date),
        '1 month'::interval
      ) AS gs
    )
    SELECT pm.month,
      COUNT(DISTINCT ma.email)::text AS community_size
    FROM period_months pm
    CROSS JOIN member_activation ma
    WHERE ma.activation_date <= pm.month_end
      AND (
        SELECT MAX(cc2.event_date)
        FROM countable_checkins cc2
        WHERE cc2.email = ma.email AND cc2.event_date <= pm.month_end
      ) + INTERVAL '9 months' > pm.month_end
    GROUP BY pm.month
    ORDER BY pm.month
  `);
  const communitySizeByMonthMap = new Map<string, number>();
  for (const r of communitySizeByMonthRows as any[]) {
    communitySizeByMonthMap.set(r.month, parseInt(r.community_size));
  }

  // Generate all months in range (no gaps)
  const fromMonth = isoDate(from).slice(0, 7);
  const toMonth = isoDate(to).slice(0, 7);
  const monthDataMap = new Map<string, { newCount: number; returningCount: number; communityCount: number }>();
  for (const r of breakdownByMonthRows as any[]) {
    monthDataMap.set(r.month, {
      newCount: parseInt(r.new_count),
      returningCount: parseInt(r.returning_count),
      communityCount: parseInt(r.community_count),
    });
  }

  const allMonths: string[] = [];
  const cur = new Date(from);
  cur.setDate(1);
  while (cur.toISOString().slice(0, 7) <= toMonth) {
    const m = cur.toISOString().slice(0, 7);
    if (m >= fromMonth) allMonths.push(m);
    cur.setMonth(cur.getMonth() + 1);
  }

  const byMonthData = allMonths.map((month) => {
    const d = monthDataMap.get(month) || { newCount: 0, returningCount: 0, communityCount: 0 };
    const gained = analyticsGainedMonthMap.get(month) || 0;
    const lost = analyticsLostMonthMap.get(month) || 0;
    return {
      month,
      newCount: d.newCount,
      returningCount: d.returningCount,
      communityCount: d.communityCount,
      communityGained: gained,
      communityLost: lost,
      cumulativeCommunity: communitySizeByMonthMap.get(month) || 0,
    };
  });

  return {
    attendanceTrend: (attendanceTrendRows as any[]).map((r) => ({
      eventName: r.name,
      date: r.event_date.split("T")[0] ?? r.event_date,
      count: parseInt(r.cnt),
    })),
    ticketTypeDistribution: (ticketTypeRows as any[]).map((r) => ({
      type: r.ticket_type,
      count: parseInt(r.cnt),
    })),
    revenueTrend: (revenueTrendRows as any[]).map((r) => ({
      month: r.month,
      revenue: parseFloat(r.revenue),
    })),
    topEvents: (topEventsRows as any[]).map((r) => ({
      eventName: r.name,
      date: r.event_date?.split("T")[0] ?? r.event_date,
      count: parseInt(r.cnt),
    })),
    topBuyers: (topBuyersRows as any[]).map((r) => ({
      email: r.email,
      name: r.name,
      count: parseInt(r.cnt),
    })),
    newVsReturning: (newVsReturningRows as any[]).map((r) => ({
      eventName: r.name,
      date: r.event_date.split("T")[0] ?? r.event_date,
      newCount: parseInt(r.new_count),
      returningCount: parseInt(r.returning_count),
    })),
    attendeeBreakdownByEvent: byEventData,
    attendeeBreakdownByMonth: byMonthData,
  };
}

// ─── Returning Attendees Export ──────────────────────────────────────────────

export async function getReturningAttendeesForExport(period: PeriodFilter): Promise<
  Array<{
    email: string;
    firstName: string;
    lastName: string;
    eventsAttended: number;
    lastEventDate: string;
    isCommunityMember: boolean;
  }>
> {
  const { from, to } = periodDates(period);

  const rows = await db.execute<{
    email: string;
    first_name: string;
    last_name: string;
    events_attended: string;
    last_event_date: string;
    is_active_member: string;
  }>(sql`
    WITH first_events AS (
      SELECT a.email, MIN(e.event_date) AS first_date
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
        AND e.merged_into_event_id IS NULL
      GROUP BY a.email
    )
    SELECT
      a.email,
      COALESCE(MAX(m.first_name), MAX(a.first_name), '') AS first_name,
      COALESCE(MAX(m.last_name), MAX(a.last_name), '') AS last_name,
      COUNT(DISTINCT e.id)::text AS events_attended,
      MAX(e.event_date)::text AS last_event_date,
      CASE WHEN BOOL_OR(m.is_active_member = true) THEN '1' ELSE '0' END AS is_active_member
    FROM ${attendees} a
    INNER JOIN ${events} e ON e.id = a.event_id
    INNER JOIN first_events fe ON LOWER(fe.email) = LOWER(a.email)
    LEFT JOIN ${members} m ON LOWER(m.email) = LOWER(a.email)
    WHERE a.checked_in = true
      AND a.order_status NOT IN ('cancelled','refunded','deleted')
      AND e.merged_into_event_id IS NULL
      AND e.event_date >= ${isoDate(from)} AND e.event_date <= ${isoDate(to)}
      AND fe.first_date < e.event_date
    GROUP BY a.email
    ORDER BY COUNT(DISTINCT e.id) DESC
  `);

  return (rows as any[]).map((r) => ({
    email: r.email,
    firstName: r.first_name,
    lastName: r.last_name,
    eventsAttended: parseInt(r.events_attended),
    lastEventDate: (r.last_event_date?.split("T")[0] ?? r.last_event_date),
    isCommunityMember: r.is_active_member === "1",
  }));
}

// ─── Member Details ──────────────────────────────────────────────────────────

export async function getReturningDetailsForEvent(eventId: string): Promise<
  Array<{
    email: string;
    name: string;
    isCommunityMember: boolean;
  }>
> {
  const rows = await db.execute<{
    email: string;
    first_name: string;
    last_name: string;
    is_active_member: string;
  }>(sql`
    SELECT
      COALESCE(m.email, a.email) AS email,
      COALESCE(m.first_name, a.first_name, '') AS first_name,
      COALESCE(m.last_name, a.last_name, '') AS last_name,
      CASE WHEN m.is_active_member = true THEN '1' ELSE '0' END AS is_active_member
    FROM ${attendees} a
    INNER JOIN ${members} m ON LOWER(m.email) = LOWER(a.email)
    WHERE a.event_id = ${eventId}
      AND a.checked_in = true
      AND a.order_status NOT IN ('cancelled','refunded','deleted')
    ORDER BY m.first_name, m.last_name
  `);

  return (rows as any[]).map((r) => ({
    email: r.email,
    name: `${r.first_name} ${r.last_name}`.trim() || r.email,
    isCommunityMember: r.is_active_member === "1",
  }));
}

export async function getNewAttendeesForEvent(eventId: string): Promise<
  Array<{ email: string; name: string }>
> {
  const rows = await db.execute<{
    email: string;
    first_name: string;
    last_name: string;
  }>(sql`
    WITH first_events AS (
      SELECT a.email, MIN(e.event_date) AS first_date
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
        AND e.merged_into_event_id IS NULL
      GROUP BY a.email
    )
    SELECT DISTINCT
      a.email,
      COALESCE(a.first_name, '') AS first_name,
      COALESCE(a.last_name, '') AS last_name
    FROM ${attendees} a
    INNER JOIN ${events} e ON e.id = a.event_id
    INNER JOIN first_events fe ON LOWER(fe.email) = LOWER(a.email)
    WHERE a.event_id = ${eventId}
      AND a.checked_in = true
      AND a.order_status NOT IN ('cancelled','refunded','deleted')
      AND fe.first_date = e.event_date
    ORDER BY first_name, last_name
  `);

  return (rows as any[]).map((r) => ({
    email: r.email,
    name: `${r.first_name} ${r.last_name}`.trim() || r.email,
  }));
}

// ─── Community Details ────────────────────────────────────────────────────────

export async function getCommunityDetailsForEvent(eventId: string): Promise<{
  gained: Array<{ email: string; name: string }>;
  lost: Array<{ email: string; name: string }>;
}> {
  // Gained: attendees whose 3rd countable event was this one
  const gainedRows = await db.execute<{
    email: string;
    first_name: string;
    last_name: string;
  }>(sql`
    WITH raw_checkins AS (
      SELECT DISTINCT ON (LOWER(a.email), e.id)
        LOWER(a.email) AS email,
        e.id AS event_id,
        e.event_date
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
        AND e.merged_into_event_id IS NULL
        AND e.name NOT ILIKE '%walk%'
        AND e.name NOT ILIKE '%party%'
        AND e.name NOT ILIKE '%drinks%'
        AND NOT (
          (e.name ILIKE '%winter%' OR e.name ILIKE '%spring%' OR e.name ILIKE '%summer%'
           OR e.name ILIKE '%autumn%' OR e.name ILIKE '%fall%' OR e.name ILIKE '%solstice%'
           OR e.name ILIKE '%equinox%')
          AND e.name ILIKE '%celebration%'
        )
      ORDER BY LOWER(a.email), e.id
    ),
    countable_checkins AS (
      SELECT email, event_id, event_date,
        ROW_NUMBER() OVER (
          PARTITION BY email
          ORDER BY event_date, event_id
        ) AS event_rank
      FROM raw_checkins
    )
    SELECT DISTINCT
      cc.email,
      COALESCE(m.first_name, '') AS first_name,
      COALESCE(m.last_name, '') AS last_name
    FROM countable_checkins cc
    LEFT JOIN ${members} m ON LOWER(m.email) = LOWER(cc.email)
    WHERE cc.event_id = ${eventId}
      AND cc.event_rank = 3
    ORDER BY first_name, last_name
  `);

  // Lost: members whose 9-month recency expired and this event is the first after expiry
  const eventRow = await db.execute<{ event_date: string }>(sql`
    SELECT event_date FROM ${events} WHERE id = ${eventId}
  `);
  const eventArr = eventRow as any[];
  if (eventArr.length === 0) {
    return { gained: [], lost: [] };
  }
  const eventDate = eventArr[0].event_date;

  // Find the previous event date in the series
  const prevEventRow = await db.execute<{ prev_date: string }>(sql`
    SELECT MAX(event_date) AS prev_date
    FROM ${events}
    WHERE event_date < ${eventDate}
      AND merged_into_event_id IS NULL
  `);
  const prevArr = prevEventRow as any[];
  const prevDate = prevArr[0]?.prev_date;

  const lostRows = await db.execute<{
    email: string;
    first_name: string;
    last_name: string;
  }>(sql`
    WITH member_last_countable AS (
      SELECT LOWER(a.email) AS email, MAX(e.event_date) AS last_countable_date
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
        AND e.merged_into_event_id IS NULL
        AND e.name NOT ILIKE '%walk%'
        AND e.name NOT ILIKE '%party%'
        AND e.name NOT ILIKE '%drinks%'
        AND NOT (
          (e.name ILIKE '%winter%' OR e.name ILIKE '%spring%' OR e.name ILIKE '%summer%'
           OR e.name ILIKE '%autumn%' OR e.name ILIKE '%fall%' OR e.name ILIKE '%solstice%'
           OR e.name ILIKE '%equinox%')
          AND e.name ILIKE '%celebration%'
        )
      GROUP BY LOWER(a.email)
      HAVING COUNT(DISTINCT e.id) >= 3
    )
    SELECT DISTINCT
      mlc.email,
      COALESCE(m.first_name, '') AS first_name,
      COALESCE(m.last_name, '') AS last_name
    FROM member_last_countable mlc
    LEFT JOIN ${members} m ON LOWER(m.email) = mlc.email
    WHERE mlc.last_countable_date + INTERVAL '9 months' > ${prevDate ? prevDate : sql`${eventDate}::date - INTERVAL '1 day'`}
      AND mlc.last_countable_date + INTERVAL '9 months' <= ${eventDate}
    ORDER BY first_name, last_name
  `);

  return {
    gained: (gainedRows as any[]).map((r) => ({
      email: r.email,
      name: `${r.first_name} ${r.last_name}`.trim() || r.email,
    })),
    lost: (lostRows as any[]).map((r) => ({
      email: r.email,
      name: `${r.first_name} ${r.last_name}`.trim() || r.email,
    })),
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

export async function runQuickValidation(
  period: PeriodFilter,
): Promise<ValidationRunResult> {
  const { from, to } = periodDates(period);
  const checks: ValidationCheck[] = [];

  // 1. Order capture: events with WC product but no attendees
  const missingOrderRows = await db.execute<{ id: string; name: string }>(sql`
    SELECT e.id, e.name
    FROM ${events} e
    WHERE e.woocommerce_product_id IS NOT NULL
      AND e.merged_into_event_id IS NULL
      AND e.event_date >= ${isoDate(from)} AND e.event_date <= ${isoDate(to)}
      AND NOT EXISTS (SELECT 1 FROM ${attendees} a WHERE a.event_id = e.id)
  `);
  const missingOrders = missingOrderRows as any[];
  checks.push({
    name: "Order Capture",
    status: missingOrders.length === 0 ? "pass" : "fail",
    message: missingOrders.length === 0
      ? "All WooCommerce events have attendee records"
      : `${missingOrders.length} event(s) with WooCommerce product but no attendees`,
    count: missingOrders.length,
    details: missingOrders.map((r) => ({ label: r.name })),
  });

  // 2. Ticket extraction: fallback ticket rate
  const fallbackRows = await db.execute<{
    event_id: string;
    name: string;
    total: string;
    fallback_count: string;
  }>(sql`
    SELECT a.event_id, e.name,
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE a.ticket_id LIKE '%-fallback-%')::text AS fallback_count
    FROM ${attendees} a
    INNER JOIN ${events} e ON e.id = a.event_id
    WHERE e.event_date >= ${isoDate(from)} AND e.event_date <= ${isoDate(to)}
      AND e.merged_into_event_id IS NULL
    GROUP BY a.event_id, e.name
    HAVING COUNT(*) FILTER (WHERE a.ticket_id LIKE '%-fallback-%') > 0
  `);
  const fbArr = fallbackRows as any[];
  const highFallback = fbArr.filter((r) => {
    const rate = parseInt(r.fallback_count) / parseInt(r.total);
    return rate > 0.2;
  });
  checks.push({
    name: "Ticket Extraction",
    status: highFallback.length === 0 ? "pass" : "warn",
    message: highFallback.length === 0
      ? "All events have good ticket extraction rates"
      : `${highFallback.length} event(s) with >20% fallback ticket rate`,
    count: highFallback.length,
    details: highFallback.map((r) => ({
      label: r.name,
      expected: "<20%",
      actual: `${Math.round((parseInt(r.fallback_count) / parseInt(r.total)) * 100)}%`,
    })),
  });

  // 3. Check-in -> Members gap
  const memberGapRows = await db.execute<{ email: string }>(sql`
    SELECT DISTINCT a.email
    FROM ${attendees} a
    INNER JOIN ${events} e ON e.id = a.event_id
    WHERE a.checked_in = true
      AND e.event_date >= ${isoDate(from)} AND e.event_date <= ${isoDate(to)}
      AND e.merged_into_event_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM ${members} m WHERE LOWER(m.email) = LOWER(a.email))
  `);
  const gaps = memberGapRows as any[];
  checks.push({
    name: "Check-in to Members",
    status: gaps.length === 0 ? "pass" : "fail",
    message: gaps.length === 0
      ? "All checked-in attendees have member records"
      : `${gaps.length} checked-in attendee email(s) without member records`,
    count: gaps.length,
    details: gaps.slice(0, 20).map((r) => ({ label: r.email })),
  });

  // 4. Membership calc accuracy (batched — single query instead of N)
  const membershipMismatchRows = await db.execute<{
    email: string;
    db_count: string;
    calc_count: string;
  }>(sql`
    WITH member_event_counts AS (
      SELECT LOWER(a.email) AS email,
        COUNT(DISTINCT e.id) FILTER (
          WHERE e.name NOT ILIKE '%walk%'
            AND e.name NOT ILIKE '%party%'
            AND e.name NOT ILIKE '%drinks%'
            AND NOT (
              (e.name ILIKE '%winter%' OR e.name ILIKE '%spring%' OR e.name ILIKE '%summer%'
               OR e.name ILIKE '%autumn%' OR e.name ILIKE '%fall%' OR e.name ILIKE '%solstice%'
               OR e.name ILIKE '%equinox%')
              AND e.name ILIKE '%celebration%'
            )
        ) AS countable_events
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
      GROUP BY LOWER(a.email)
    )
    SELECT m.email, m.total_events_attended::text AS db_count, COALESCE(mec.countable_events, 0)::text AS calc_count
    FROM ${members} m
    LEFT JOIN member_event_counts mec ON LOWER(m.email) = mec.email
    WHERE COALESCE(mec.countable_events, 0) != m.total_events_attended
  `);
  const membershipMismatches = (membershipMismatchRows as any[]).length;
  const membershipDetails: ValidationCheck["details"] = (membershipMismatchRows as any[])
    .slice(0, 10)
    .map((r) => ({
      label: r.email,
      expected: parseInt(r.calc_count),
      actual: parseInt(r.db_count),
    }));

  checks.push({
    name: "Membership Calculation",
    status: membershipMismatches === 0 ? "pass" : "warn",
    message: membershipMismatches === 0
      ? "All member event counts match calculated values"
      : `${membershipMismatches} member(s) with mismatched event counts`,
    count: membershipMismatches,
    details: membershipDetails,
  });

  // 5. Active status accuracy (batched — single query instead of N)
  const nineMonthsAgoDate = new Date();
  nineMonthsAgoDate.setMonth(nineMonthsAgoDate.getMonth() - 9);
  const nineMonthsAgo = nineMonthsAgoDate.toISOString();

  const statusMismatchRows = await db.execute<{
    email: string;
    is_active_member: string;
    expected_active: string;
  }>(sql`
    WITH member_event_counts AS (
      SELECT LOWER(a.email) AS email,
        COUNT(DISTINCT e.id) FILTER (
          WHERE e.name NOT ILIKE '%walk%'
            AND e.name NOT ILIKE '%party%'
            AND e.name NOT ILIKE '%drinks%'
            AND NOT (
              (e.name ILIKE '%winter%' OR e.name ILIKE '%spring%' OR e.name ILIKE '%summer%'
               OR e.name ILIKE '%autumn%' OR e.name ILIKE '%fall%' OR e.name ILIKE '%solstice%'
               OR e.name ILIKE '%equinox%')
              AND e.name ILIKE '%celebration%'
            )
        ) AS countable_all,
        COUNT(DISTINCT e.id) FILTER (
          WHERE e.event_date >= ${nineMonthsAgo}
            AND e.name NOT ILIKE '%walk%'
            AND e.name NOT ILIKE '%party%'
            AND e.name NOT ILIKE '%drinks%'
            AND NOT (
              (e.name ILIKE '%winter%' OR e.name ILIKE '%spring%' OR e.name ILIKE '%summer%'
               OR e.name ILIKE '%autumn%' OR e.name ILIKE '%fall%' OR e.name ILIKE '%solstice%'
               OR e.name ILIKE '%equinox%')
              AND e.name ILIKE '%celebration%'
            )
        ) AS countable_recent
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
      GROUP BY LOWER(a.email)
    )
    SELECT m.email,
      m.is_active_member::text,
      CASE WHEN COALESCE(mec.countable_all, 0) >= 3 AND COALESCE(mec.countable_recent, 0) >= 1
        THEN 'true' ELSE 'false'
      END AS expected_active
    FROM ${members} m
    LEFT JOIN member_event_counts mec ON LOWER(m.email) = mec.email
    WHERE m.manually_added = false
      AND m.is_active_member::text != (
        CASE WHEN COALESCE(mec.countable_all, 0) >= 3 AND COALESCE(mec.countable_recent, 0) >= 1
          THEN 'true' ELSE 'false'
        END
      )
  `);
  const statusMismatches = (statusMismatchRows as any[]).length;
  const statusDetails: ValidationCheck["details"] = (statusMismatchRows as any[])
    .slice(0, 10)
    .map((r) => ({
      label: r.email,
      expected: r.expected_active === "true" ? "active" : "inactive",
      actual: r.is_active_member === "true" ? "active" : "inactive",
    }));

  checks.push({
    name: "Active Status Accuracy",
    status: statusMismatches === 0 ? "pass" : "fail",
    message: statusMismatches === 0
      ? "All non-manual member active statuses match calculated values"
      : `${statusMismatches} member(s) with incorrect active status`,
    count: statusMismatches,
    details: statusDetails,
  });

  // 6. Data quality
  const qualityRows = await db.execute<{
    empty_email: string;
    empty_name: string;
    orphan_members: string;
  }>(sql`
    SELECT
      (SELECT COUNT(*)::text FROM ${attendees} a INNER JOIN ${events} e ON e.id = a.event_id
       WHERE (a.email IS NULL OR a.email = '')
         AND e.event_date >= ${isoDate(from)} AND e.event_date <= ${isoDate(to)}
         AND e.merged_into_event_id IS NULL) AS empty_email,
      (SELECT COUNT(*)::text FROM ${attendees} a INNER JOIN ${events} e ON e.id = a.event_id
       WHERE (a.first_name IS NULL OR a.first_name = '') AND (a.last_name IS NULL OR a.last_name = '')
         AND e.event_date >= ${isoDate(from)} AND e.event_date <= ${isoDate(to)}
         AND e.merged_into_event_id IS NULL) AS empty_name,
      (SELECT COUNT(*)::text FROM ${members} m
       WHERE NOT EXISTS (SELECT 1 FROM ${attendees} a WHERE LOWER(a.email) = LOWER(m.email))) AS orphan_members
  `);
  const qr = qualityRows[0] as any;
  const emptyEmail = parseInt(qr?.empty_email ?? "0");
  const emptyName = parseInt(qr?.empty_name ?? "0");
  const orphanMembers = parseInt(qr?.orphan_members ?? "0");
  const totalIssues = emptyEmail + emptyName + orphanMembers;

  checks.push({
    name: "Data Quality",
    status: totalIssues === 0 ? "pass" : "warn",
    message: totalIssues === 0
      ? "No data quality issues found"
      : `Found ${totalIssues} data quality issue(s)`,
    count: totalIssues,
    details: [
      ...(emptyEmail > 0 ? [{ label: "Attendees with empty email", actual: emptyEmail }] : []),
      ...(emptyName > 0 ? [{ label: "Attendees with empty name", actual: emptyName }] : []),
      ...(orphanMembers > 0 ? [{ label: "Members with no attendee records", actual: orphanMembers }] : []),
    ],
  });

  // 7. Revenue Audit
  const revenueAuditRows = await db.execute<{
    total_attendees: string;
    with_order_total: string;
    non_zero: string;
    total_sum: string;
  }>(sql`
    SELECT
      COUNT(*)::text AS total_attendees,
      COUNT(a.order_total)::text AS with_order_total,
      COUNT(*) FILTER (WHERE a.order_total > 0)::text AS non_zero,
      COALESCE(SUM(a.order_total) FILTER (WHERE a.order_status NOT IN ('cancelled','refunded','deleted')), 0)::text AS total_sum
    FROM ${attendees} a
    INNER JOIN ${events} e ON e.id = a.event_id
    WHERE e.event_date >= ${isoDate(from)} AND e.event_date <= ${isoDate(to)}
      AND e.merged_into_event_id IS NULL
  `);
  const ra = revenueAuditRows[0] as any;
  const raTotalAttendees = parseInt(ra?.total_attendees ?? "0");
  const raWithOrderTotal = parseInt(ra?.with_order_total ?? "0");
  const raNonZero = parseInt(ra?.non_zero ?? "0");
  const raTotalSum = parseFloat(ra?.total_sum ?? "0");

  checks.push({
    name: "Revenue Audit",
    status: raNonZero > 0 ? "pass" : "warn",
    message: raNonZero > 0
      ? `£${raTotalSum.toLocaleString("en-GB", { minimumFractionDigits: 2 })} total revenue from ${raNonZero} attendee(s) with non-zero order totals`
      : `No non-zero order totals found among ${raTotalAttendees} attendee(s) in this period`,
    count: raNonZero,
    details: [
      { label: "Total attendees in period", actual: raTotalAttendees },
      { label: "Attendees with order_total field", actual: raWithOrderTotal },
      { label: "Attendees with order_total > 0", actual: raNonZero },
      { label: "Sum of valid order totals", actual: `£${raTotalSum.toFixed(2)}` },
    ],
  });

  // Build result
  const summary = {
    passed: checks.filter((c) => c.status === "pass").length,
    warnings: checks.filter((c) => c.status === "warn").length,
    failures: checks.filter((c) => c.status === "fail").length,
  };

  const result: ValidationRunResult = {
    id: "",
    runAt: new Date(),
    mode: "quick",
    periodFrom: from,
    periodTo: to,
    checks,
    summary,
  };

  // Save to DB
  const [saved] = await db
    .insert(validationResults)
    .values({
      runAt: new Date(),
      mode: "quick",
      periodFrom: from,
      periodTo: to,
      results: { checks, summary },
    })
    .returning();

  result.id = saved!.id;

  // Keep only last 10 runs
  const allRuns = await db
    .select({ id: validationResults.id })
    .from(validationResults)
    .orderBy(desc(validationResults.runAt));
  if (allRuns.length > 10) {
    const toDelete = allRuns.slice(10).map((r) => r.id);
    for (const id of toDelete) {
      await db.delete(validationResults).where(eq(validationResults.id, id));
    }
  }

  return result;
}

export async function runDeepValidation(
  period: PeriodFilter,
): Promise<ValidationRunResult> {
  // Run all quick checks first
  const quickResult = await runQuickValidation(period);
  const checks = [...quickResult.checks];

  const { from, to } = periodDates(period);

  // Get events with WC product IDs in period
  const wcEvents = await db
    .select()
    .from(events)
    .where(
      and(
        isNotNull(events.woocommerceProductId),
        isNull(events.mergedIntoEventId),
        gte(events.eventDate, from),
        lte(events.eventDate, to),
      ),
    );

  // 7. WC <-> DB reconciliation
  const { getOrdersForProductCached } = await import("@/lib/woocommerce");
  const reconDetails: ValidationCheck["details"] = [];
  let reconIssues = 0;

  for (const event of wcEvents) {
    if (!event.woocommerceProductId) continue;
    try {
      const wcOrders = await getOrdersForProductCached(
        event.woocommerceProductId,
        event.eventDate,
        true,
      );
      const dbAttendees = await db
        .select()
        .from(attendees)
        .where(eq(attendees.eventId, event.id));

      const wcOrderIds = new Set(wcOrders.map((o: any) => o.id.toString()));
      const dbOrderIds = new Set(
        dbAttendees
          .map((a) => a.woocommerceOrderId)
          .filter((id): id is string => id !== null),
      );

      const missingInDb = [...wcOrderIds].filter((id) => !dbOrderIds.has(id));
      const extraInDb = [...dbOrderIds].filter((id) => !wcOrderIds.has(id));

      if (missingInDb.length > 0 || extraInDb.length > 0) {
        reconIssues++;
        reconDetails.push({
          label: event.name,
          expected: `${wcOrderIds.size} WC orders`,
          actual: `${dbOrderIds.size} DB orders (${missingInDb.length} missing, ${extraInDb.length} extra)`,
        });
      }
    } catch {
      reconDetails.push({ label: `${event.name} - API error` });
      reconIssues++;
    }
  }

  checks.push({
    name: "WC/DB Order Reconciliation",
    status: reconIssues === 0 ? "pass" : reconIssues <= 2 ? "warn" : "fail",
    message: reconIssues === 0
      ? "All WooCommerce orders match database records"
      : `${reconIssues} event(s) with order discrepancies`,
    count: reconIssues,
    details: reconDetails,
  });

  // 8. Revenue comparison
  const revenueDetails: ValidationCheck["details"] = [];
  let revenueIssues = 0;

  for (const event of wcEvents) {
    if (!event.woocommerceProductId) continue;
    try {
      const wcOrders = await getOrdersForProductCached(
        event.woocommerceProductId,
        event.eventDate,
        false,
      );
      const wcTotal = wcOrders.reduce(
        (sum: number, o: any) => sum + parseFloat(o.total || "0"),
        0,
      );

      const dbResult = await db.execute<{ total: string }>(sql`
        SELECT COALESCE(SUM(order_total), 0)::text AS total
        FROM ${attendees}
        WHERE event_id = ${event.id}
          AND order_status NOT IN ('cancelled','refunded','deleted')
      `);
      const dbTotal = parseFloat(
        (dbResult[0] as any)?.total ?? "0",
      );

      if (wcTotal > 0 && Math.abs(wcTotal - dbTotal) / wcTotal > 0.01) {
        revenueIssues++;
        revenueDetails.push({
          label: event.name,
          expected: `£${wcTotal.toFixed(2)} (WC)`,
          actual: `£${dbTotal.toFixed(2)} (DB)`,
        });
      }
    } catch {
      // skip on error
    }
  }

  checks.push({
    name: "Revenue Comparison",
    status: revenueIssues === 0 ? "pass" : "warn",
    message: revenueIssues === 0
      ? "Revenue matches between WooCommerce and database"
      : `${revenueIssues} event(s) with revenue discrepancies >1%`,
    count: revenueIssues,
    details: revenueDetails,
  });

  // 9. Status sync
  const statusSyncDetails: ValidationCheck["details"] = [];
  let statusSyncIssues = 0;

  for (const event of wcEvents) {
    if (!event.woocommerceProductId) continue;
    try {
      const wcOrders = await getOrdersForProductCached(
        event.woocommerceProductId,
        event.eventDate,
        false,
      );

      for (const wcOrder of wcOrders) {
        const dbRecords = await db
          .select()
          .from(attendees)
          .where(
            and(
              eq(attendees.eventId, event.id),
              eq(attendees.woocommerceOrderId, wcOrder.id.toString()),
            ),
          );

        for (const dbRec of dbRecords) {
          if (
            dbRec.orderStatus !== "deleted" &&
            dbRec.orderStatus !== wcOrder.status
          ) {
            statusSyncIssues++;
            if (statusSyncDetails.length < 10) {
              statusSyncDetails.push({
                label: `Order ${wcOrder.id} (${event.name})`,
                expected: wcOrder.status,
                actual: dbRec.orderStatus ?? "unknown",
              });
            }
          }
        }
      }
    } catch {
      // skip
    }
  }

  checks.push({
    name: "Order Status Sync",
    status: statusSyncIssues === 0 ? "pass" : "warn",
    message: statusSyncIssues === 0
      ? "All order statuses match WooCommerce"
      : `${statusSyncIssues} order(s) with mismatched status`,
    count: statusSyncIssues,
    details: statusSyncDetails,
  });

  const summary = {
    passed: checks.filter((c) => c.status === "pass").length,
    warnings: checks.filter((c) => c.status === "warn").length,
    failures: checks.filter((c) => c.status === "fail").length,
  };

  // Save deep validation result (update the quick one)
  const [saved] = await db
    .insert(validationResults)
    .values({
      runAt: new Date(),
      mode: "deep",
      periodFrom: from,
      periodTo: to,
      results: { checks, summary },
    })
    .returning();

  return {
    id: saved!.id,
    runAt: new Date(),
    mode: "deep",
    periodFrom: from,
    periodTo: to,
    checks,
    summary,
  };
}

export async function getLastValidationRuns(
  limit = 5,
): Promise<ValidationRunResult[]> {
  const rows = await db
    .select()
    .from(validationResults)
    .orderBy(desc(validationResults.runAt))
    .limit(limit);

  return rows.map((r) => {
    const data = r.results as any;
    return {
      id: r.id,
      runAt: r.runAt,
      mode: r.mode as "quick" | "deep",
      periodFrom: r.periodFrom,
      periodTo: r.periodTo,
      checks: data.checks ?? [],
      summary: data.summary ?? { passed: 0, warnings: 0, failures: 0 },
    };
  });
}
