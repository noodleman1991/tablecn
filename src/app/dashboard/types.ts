export interface PeriodFilter {
  from: Date | string;
  to: Date | string;
}

export interface DashboardStats {
  eventsCount: number;
  ticketsCount: number;
  validTickets: number;
  checkedInCount: number;
  checkinRate: number;
  communityMembersCount: number;
  totalRevenue: number;
}

export interface FunnelEventRow {
  eventId: string;
  eventName: string;
  eventDate: Date;
  ordersCount: number;
  ticketBreakdown: Record<string, number>;
  totalTickets: number;
  validTickets: number;
  checkedInCount: number;
  checkedInPercent: number;
  returningCount: number;
  communityGained: number;
  communityLost: number;
  newCount: number;
  revenue: number;
}

export interface FunnelMonthRow {
  month: string;
  eventsCount: number;
  ordersCount: number;
  ticketBreakdown: Record<string, number>;
  totalTickets: number;
  validTickets: number;
  checkedInCount: number;
  checkedInPercent: number;
  returningCount: number;
  communityGained: number;
  communityLost: number;
  newCount: number;
  revenue: number;
}

export interface AnalyticsData {
  attendanceTrend: Array<{ eventName: string; date: string; count: number }>;

  ticketTypeDistribution: Array<{ type: string; count: number }>;
  revenueTrend: Array<{ month: string; revenue: number }>;
  topEvents: Array<{ eventName: string; date: string; count: number }>;
  topBuyers: Array<{ email: string; name: string; count: number }>;
  newVsReturning: Array<{
    eventName: string;
    date: string;
    newCount: number;
    returningCount: number;
  }>;
  attendeeBreakdownByEvent: Array<{
    eventName: string;
    date: string;
    newCount: number;
    returningCount: number;
    communityCount: number;
    communityGained: number;
    communityLost: number;
    cumulativeCommunity: number;
  }>;
  attendeeBreakdownByMonth: Array<{
    month: string;
    newCount: number;
    returningCount: number;
    communityCount: number;
    communityGained: number;
    communityLost: number;
    cumulativeCommunity: number;
  }>;
}

export type ReturningMode = "attendance" | "purchase";

export interface CohortRow {
  bucket: string;
  bucketLabel: string;
  newCount: number;
  returningCount: number;
  communityCount: number;
  totalCount: number;
  hasMismatch: boolean;
}

export interface SuperAttendee {
  email: string;
  firstName: string;
  lastName: string;
  eventsAttended: number;
  lastEventDate: string;
  isCommunityMember: boolean;
}

export interface AttendeeHistoryEntry {
  eventId: string;
  eventName: string;
  eventDate: string;
  checkedIn: boolean;
}

export interface ValidationCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  count: number;
  details: Array<{
    label: string;
    expected?: string | number;
    actual?: string | number;
  }>;
}

export interface ValidationRunResult {
  id: string;
  runAt: Date;
  mode: "quick" | "deep";
  periodFrom: Date | string;
  periodTo: Date | string;
  checks: ValidationCheck[];
  summary: { passed: number; warnings: number; failures: number };
}
