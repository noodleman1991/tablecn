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
  return {
    from: new Date(period.from).toISOString(),
    to: new Date(period.to).toISOString(),
  };
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
      WHERE ${events.eventDate} >= ${from}
        AND ${events.eventDate} <= ${to}
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

  const row = statsRows.rows?.[0] ?? statsRows[0];
  const eventsCount = parseInt(row?.events_count ?? "0");
  const ticketsCount = parseInt(row?.tickets_count ?? "0");
  const validTickets = parseInt(row?.valid_tickets ?? "0");
  const checkedInCount = parseInt(row?.checked_in_count ?? "0");
  const totalRevenue = parseFloat(row?.total_revenue ?? "0");

  const activeResult = await db
    .select({ count: sql<string>`COUNT(*)::text` })
    .from(members)
    .where(eq(members.isActiveMember, true));
  const activeMembersCount = parseInt(activeResult[0]?.count ?? "0");

  const checkinRate = validTickets > 0 ? (checkedInCount / validTickets) * 100 : 0;

  return {
    eventsCount,
    ticketsCount,
    validTickets,
    checkedInCount,
    checkinRate,
    activeMembersCount,
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
    WHERE e.event_date >= ${from}
      AND e.event_date <= ${to}
      AND e.merged_into_event_id IS NULL
    GROUP BY e.id
    ORDER BY e.event_date DESC
  `);

  const rows = mainRows.rows ?? mainRows;

  // Ticket type breakdown
  const ticketRows = await db.execute<{
    event_id: string;
    ticket_type: string;
    cnt: string;
  }>(sql`
    SELECT a.event_id, COALESCE(a.ticket_type, 'Unknown') AS ticket_type, COUNT(*)::text AS cnt
    FROM ${attendees} a
    INNER JOIN ${events} e ON e.id = a.event_id
    WHERE e.event_date >= ${from}
      AND e.event_date <= ${to}
      AND e.merged_into_event_id IS NULL
      AND a.order_status NOT IN ('cancelled','refunded','deleted')
    GROUP BY a.event_id, a.ticket_type
  `);
  const ticketTypeMap = new Map<string, Record<string, number>>();
  for (const tr of (ticketRows.rows ?? ticketRows) as any[]) {
    if (!ticketTypeMap.has(tr.event_id)) ticketTypeMap.set(tr.event_id, {});
    ticketTypeMap.get(tr.event_id)![tr.ticket_type] = parseInt(tr.cnt);
  }

  // Member conversions
  const convRows = await db.execute<{
    event_id: string;
    cnt: string;
  }>(sql`
    SELECT a.event_id, COUNT(DISTINCT a.email)::text AS cnt
    FROM ${attendees} a
    INNER JOIN ${members} m ON LOWER(a.email) = LOWER(m.email)
    INNER JOIN ${events} e ON e.id = a.event_id
    WHERE a.checked_in = true
      AND e.event_date >= ${from}
      AND e.event_date <= ${to}
      AND e.merged_into_event_id IS NULL
    GROUP BY a.event_id
  `);
  const convMap = new Map<string, number>();
  for (const cr of (convRows.rows ?? convRows) as any[]) {
    convMap.set(cr.event_id, parseInt(cr.cnt));
  }

  return (rows as any[]).map((r) => {
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
      memberConversions: convMap.get(r.id) || 0,
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
    WHERE e.event_date >= ${from}
      AND e.event_date <= ${to}
      AND e.merged_into_event_id IS NULL
    GROUP BY TO_CHAR(e.event_date, 'YYYY-MM')
    ORDER BY month DESC
  `);

  const rows = mainRows.rows ?? mainRows;

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
    WHERE e.event_date >= ${from}
      AND e.event_date <= ${to}
      AND e.merged_into_event_id IS NULL
      AND a.order_status NOT IN ('cancelled','refunded','deleted')
    GROUP BY TO_CHAR(e.event_date, 'YYYY-MM'), a.ticket_type
  `);
  const ticketTypeMap = new Map<string, Record<string, number>>();
  for (const tr of (ticketRows.rows ?? ticketRows) as any[]) {
    if (!ticketTypeMap.has(tr.month)) ticketTypeMap.set(tr.month, {});
    ticketTypeMap.get(tr.month)![tr.ticket_type] = parseInt(tr.cnt);
  }

  // Member conversions by month
  const convRows = await db.execute<{
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
      AND e.event_date >= ${from}
      AND e.event_date <= ${to}
      AND e.merged_into_event_id IS NULL
    GROUP BY TO_CHAR(e.event_date, 'YYYY-MM')
  `);
  const convMap = new Map<string, number>();
  for (const cr of (convRows.rows ?? convRows) as any[]) {
    convMap.set(cr.month, parseInt(cr.cnt));
  }

  return (rows as any[]).map((r) => {
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
      memberConversions: convMap.get(r.month) || 0,
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
    WHERE e.event_date >= ${from} AND e.event_date <= ${to}
      AND e.merged_into_event_id IS NULL
    GROUP BY e.id, e.name, e.event_date
    ORDER BY e.event_date
  `);

  // Check-in rate trend
  const checkinRateRows = await db.execute<{
    name: string;
    event_date: string;
    valid: string;
    checked: string;
  }>(sql`
    SELECT e.name, e.event_date::text,
      COUNT(a.id) FILTER (WHERE a.order_status NOT IN ('cancelled','refunded','deleted'))::text AS valid,
      COUNT(a.id) FILTER (WHERE a.checked_in = true AND a.order_status NOT IN ('cancelled','refunded','deleted'))::text AS checked
    FROM ${events} e
    LEFT JOIN ${attendees} a ON a.event_id = e.id
    WHERE e.event_date >= ${from} AND e.event_date <= ${to}
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
    WHERE e.event_date >= ${from} AND e.event_date <= ${to}
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
    WHERE e.event_date >= ${from} AND e.event_date <= ${to}
      AND e.merged_into_event_id IS NULL
    GROUP BY TO_CHAR(e.event_date, 'YYYY-MM')
    ORDER BY month
  `);

  // Top events
  const topEventsRows = await db.execute<{
    name: string;
    cnt: string;
  }>(sql`
    SELECT e.name,
      COUNT(a.id) FILTER (WHERE a.checked_in = true AND a.order_status NOT IN ('cancelled','refunded','deleted'))::text AS cnt
    FROM ${events} e
    LEFT JOIN ${attendees} a ON a.event_id = e.id
    WHERE e.event_date >= ${from} AND e.event_date <= ${to}
      AND e.merged_into_event_id IS NULL
    GROUP BY e.id, e.name
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
    WHERE e.event_date >= ${from} AND e.event_date <= ${to}
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
    WHERE e.event_date >= ${from} AND e.event_date <= ${to}
      AND e.merged_into_event_id IS NULL
    GROUP BY e.id, e.name, e.event_date
    ORDER BY e.event_date
  `);

  const asArr = (r: any) => r.rows ?? r;

  return {
    attendanceTrend: (asArr(attendanceTrendRows) as any[]).map((r) => ({
      eventName: r.name,
      date: r.event_date.split("T")[0] ?? r.event_date,
      count: parseInt(r.cnt),
    })),
    checkinRateTrend: (asArr(checkinRateRows) as any[]).map((r) => {
      const valid = parseInt(r.valid);
      const checked = parseInt(r.checked);
      return {
        eventName: r.name,
        date: r.event_date.split("T")[0] ?? r.event_date,
        rate: valid > 0 ? Math.round((checked / valid) * 100) : 0,
      };
    }),
    ticketTypeDistribution: (asArr(ticketTypeRows) as any[]).map((r) => ({
      type: r.ticket_type,
      count: parseInt(r.cnt),
    })),
    revenueTrend: (asArr(revenueTrendRows) as any[]).map((r) => ({
      month: r.month,
      revenue: parseFloat(r.revenue),
    })),
    topEvents: (asArr(topEventsRows) as any[]).map((r) => ({
      eventName: r.name,
      count: parseInt(r.cnt),
    })),
    topBuyers: (asArr(topBuyersRows) as any[]).map((r) => ({
      email: r.email,
      name: r.name,
      count: parseInt(r.cnt),
    })),
    newVsReturning: (asArr(newVsReturningRows) as any[]).map((r) => ({
      eventName: r.name,
      date: r.event_date.split("T")[0] ?? r.event_date,
      newCount: parseInt(r.new_count),
      returningCount: parseInt(r.returning_count),
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
      AND e.event_date >= ${from} AND e.event_date <= ${to}
      AND NOT EXISTS (SELECT 1 FROM ${attendees} a WHERE a.event_id = e.id)
  `);
  const missingOrders = (missingOrderRows.rows ?? missingOrderRows) as any[];
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
    WHERE e.event_date >= ${from} AND e.event_date <= ${to}
      AND e.merged_into_event_id IS NULL
    GROUP BY a.event_id, e.name
    HAVING COUNT(*) FILTER (WHERE a.ticket_id LIKE '%-fallback-%') > 0
  `);
  const fbArr = (fallbackRows.rows ?? fallbackRows) as any[];
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
      AND e.event_date >= ${from} AND e.event_date <= ${to}
      AND e.merged_into_event_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM ${members} m WHERE LOWER(m.email) = LOWER(a.email))
  `);
  const gaps = (memberGapRows.rows ?? memberGapRows) as any[];
  checks.push({
    name: "Check-in to Members",
    status: gaps.length === 0 ? "pass" : "fail",
    message: gaps.length === 0
      ? "All checked-in attendees have member records"
      : `${gaps.length} checked-in attendee email(s) without member records`,
    count: gaps.length,
    details: gaps.slice(0, 20).map((r) => ({ label: r.email })),
  });

  // 4. Membership calc accuracy
  const memberRows = await db.select().from(members);
  const isSocialEvent = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes("walk") || lower.includes("party") || lower.includes("drinks")) return true;
    const seasons = ["winter", "spring", "summer", "autumn", "fall", "solstice", "equinox"];
    const hasSeason = seasons.some((s) => lower.includes(s));
    return hasSeason && lower.includes("celebration");
  };

  let membershipMismatches = 0;
  const membershipDetails: ValidationCheck["details"] = [];

  for (const member of memberRows) {
    const attended = await db.execute<{ name: string }>(sql`
      SELECT e.name
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE LOWER(a.email) = LOWER(${member.email})
        AND a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
    `);
    const countable = ((attended.rows ?? attended) as any[]).filter(
      (r) => !isSocialEvent(r.name),
    ).length;
    if (countable !== member.totalEventsAttended) {
      membershipMismatches++;
      if (membershipDetails.length < 10) {
        membershipDetails.push({
          label: member.email,
          expected: countable,
          actual: member.totalEventsAttended,
        });
      }
    }
  }

  checks.push({
    name: "Membership Calculation",
    status: membershipMismatches === 0 ? "pass" : "warn",
    message: membershipMismatches === 0
      ? "All member event counts match calculated values"
      : `${membershipMismatches} member(s) with mismatched event counts`,
    count: membershipMismatches,
    details: membershipDetails,
  });

  // 5. Active status accuracy
  const nineMonthsAgoDate = new Date();
  nineMonthsAgoDate.setMonth(nineMonthsAgoDate.getMonth() - 9);
  const nineMonthsAgo = nineMonthsAgoDate.toISOString();

  let statusMismatches = 0;
  const statusDetails: ValidationCheck["details"] = [];

  for (const member of memberRows) {
    const allAttended = await db.execute<{ name: string }>(sql`
      SELECT e.name
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE LOWER(a.email) = LOWER(${member.email})
        AND a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
    `);
    const countableAll = ((allAttended.rows ?? allAttended) as any[]).filter(
      (r) => !isSocialEvent(r.name),
    ).length;

    const recentAttended = await db.execute<{ name: string }>(sql`
      SELECT e.name
      FROM ${attendees} a
      INNER JOIN ${events} e ON e.id = a.event_id
      WHERE LOWER(a.email) = LOWER(${member.email})
        AND a.checked_in = true
        AND a.order_status NOT IN ('cancelled','refunded','deleted')
        AND e.event_date >= ${nineMonthsAgo}
    `);
    const countableRecent = ((recentAttended.rows ?? recentAttended) as any[]).filter(
      (r) => !isSocialEvent(r.name),
    ).length;

    const expectedActive = countableAll >= 3 && countableRecent >= 1;
    // Skip manually-added members as their status can be overridden
    if (!member.manuallyAdded && member.isActiveMember !== expectedActive) {
      statusMismatches++;
      if (statusDetails.length < 10) {
        statusDetails.push({
          label: member.email,
          expected: expectedActive ? "active" : "inactive",
          actual: member.isActiveMember ? "active" : "inactive",
        });
      }
    }
  }

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
         AND e.event_date >= ${from} AND e.event_date <= ${to}
         AND e.merged_into_event_id IS NULL) AS empty_email,
      (SELECT COUNT(*)::text FROM ${attendees} a INNER JOIN ${events} e ON e.id = a.event_id
       WHERE (a.first_name IS NULL OR a.first_name = '') AND (a.last_name IS NULL OR a.last_name = '')
         AND e.event_date >= ${from} AND e.event_date <= ${to}
         AND e.merged_into_event_id IS NULL) AS empty_name,
      (SELECT COUNT(*)::text FROM ${members} m
       WHERE NOT EXISTS (SELECT 1 FROM ${attendees} a WHERE LOWER(a.email) = LOWER(m.email))) AS orphan_members
  `);
  const qr = (qualityRows.rows ?? qualityRows)[0] as any;
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
        ((dbResult.rows ?? dbResult)[0] as any)?.total ?? "0",
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
