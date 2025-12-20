/**
 * Attendee Grouping Utilities
 *
 * Groups attendees by (email + firstName + lastName) for display purposes.
 * Used across check-in table UI and CSV exports to show ticket counts.
 *
 * IMPORTANT: Grouping is VIEW-ONLY. Database maintains one record per ticket.
 */

import type { Attendee } from "@/db/schema";

export interface GroupedAttendee {
  // Unique identifier for the group (used as table row ID)
  id: string;

  // Representative data (from first ticket in group)
  email: string;
  firstName: string | null;
  lastName: string | null;

  // Aggregated data
  ticketCount: number;
  tickets: Attendee[];  // All individual ticket records

  // Check-in status aggregation
  allCheckedIn: boolean;
  someCheckedIn: boolean;
  checkedInCount: number;
  checkedInStatus: "all" | "partial" | "none";

  // Source flags (for Manual/Edited badges)
  isManuallyAdded: boolean;
  isLocallyModified: boolean;

  // Combined WooCommerce order IDs
  orderIds: string[];

  // Timestamps
  mostRecentCheckIn: Date | null;

  // Original event ID (all tickets in group have same eventId)
  eventId: string;
}

/**
 * Groups attendees by (email + firstName + lastName)
 * Same email + same name = grouped
 * Same email + different names = separate rows
 */
export function groupAttendeesByPerson(attendees: Attendee[]): GroupedAttendee[] {
  // Group by unique key: email|firstName|lastName
  const grouped = new Map<string, Attendee[]>();

  for (const attendee of attendees) {
    const key = `${attendee.email}|${attendee.firstName || ""}|${attendee.lastName || ""}`;

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key)!.push(attendee);
  }

  // Transform each group into GroupedAttendee
  const result: GroupedAttendee[] = [];

  for (const [key, tickets] of grouped.entries()) {
    // Sort tickets by creation date (oldest first) for consistency
    tickets.sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const first = tickets[0]!;

    // Calculate check-in status
    const checkedInTickets = tickets.filter(t => t.checkedIn);
    const checkedInCount = checkedInTickets.length;
    const allCheckedIn = checkedInCount === tickets.length;
    const someCheckedIn = checkedInCount > 0;

    let checkedInStatus: "all" | "partial" | "none";
    if (allCheckedIn) {
      checkedInStatus = "all";
    } else if (someCheckedIn) {
      checkedInStatus = "partial";
    } else {
      checkedInStatus = "none";
    }

    // Get most recent check-in time
    const checkInTimes = tickets
      .filter(t => t.checkedInAt)
      .map(t => t.checkedInAt!)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    const mostRecentCheckIn = checkInTimes.length > 0 ? checkInTimes[0]! : null;

    // Aggregate source flags
    const isManuallyAdded = tickets.some(t => t.manuallyAdded);
    const isLocallyModified = tickets.some(t => t.locallyModified);

    // Collect order IDs
    const orderIds = tickets
      .map(t => t.woocommerceOrderId)
      .filter((id): id is string => id !== null && id !== undefined);

    result.push({
      id: key, // Use grouping key as unique ID
      email: first.email,
      firstName: first.firstName,
      lastName: first.lastName,
      ticketCount: tickets.length,
      tickets,
      allCheckedIn,
      someCheckedIn,
      checkedInCount,
      checkedInStatus,
      isManuallyAdded,
      isLocallyModified,
      orderIds,
      mostRecentCheckIn,
      eventId: first.eventId,
    });
  }

  // Sort by email, then firstName, then lastName for consistent ordering
  result.sort((a, b) => {
    const emailCompare = a.email.localeCompare(b.email);
    if (emailCompare !== 0) return emailCompare;

    const firstNameCompare = (a.firstName || "").localeCompare(b.firstName || "");
    if (firstNameCompare !== 0) return firstNameCompare;

    return (a.lastName || "").localeCompare(b.lastName || "");
  });

  return result;
}

/**
 * Ungroups a GroupedAttendee back into individual ticket records
 * Useful when you need to work with individual tickets
 */
export function ungroupAttendee(grouped: GroupedAttendee): Attendee[] {
  return grouped.tickets;
}

/**
 * Checks if a GroupedAttendee is actually a group (2+ tickets)
 */
export function isActuallyGrouped(grouped: GroupedAttendee): boolean {
  return grouped.ticketCount > 1;
}

/**
 * Gets the check-in status display string
 */
export function getCheckInStatusDisplay(grouped: GroupedAttendee): string {
  if (grouped.checkedInStatus === "all") {
    return "Yes";
  } else if (grouped.checkedInStatus === "partial") {
    return `Partial (${grouped.checkedInCount}/${grouped.ticketCount})`;
  } else {
    return "No";
  }
}
