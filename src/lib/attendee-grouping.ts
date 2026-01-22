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
 * Checks if a GroupedAttendee or GroupedOrder is actually a group (2+ tickets)
 */
export function isActuallyGrouped(grouped: GroupedAttendee | GroupedOrder): boolean {
  return grouped.ticketCount > 1;
}

/**
 * Gets the check-in status display string
 */
export function getCheckInStatusDisplay(grouped: GroupedAttendee | GroupedOrder): string {
  if (grouped.checkedInStatus === "all") {
    return "Yes";
  } else if (grouped.checkedInStatus === "partial") {
    return `Partial (${grouped.checkedInCount}/${grouped.ticketCount})`;
  } else {
    return "No";
  }
}

/**
 * Order-Based Grouping (new approach for multi-ticket orders)
 */

export interface GroupedOrder {
  // Unique identifier for the group (woocommerceOrderId or generated ID for manual attendees)
  id: string;

  // Booker information (from first ticket's booker fields)
  bookerFirstName: string | null;
  bookerLastName: string | null;
  bookerEmail: string | null;

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

  // WooCommerce order ID (null for manually added attendees)
  woocommerceOrderId: string | null;

  // Timestamps
  mostRecentCheckIn: Date | null;

  // Original event ID (all tickets in group have same eventId)
  eventId: string;
}

/**
 * Groups attendees by ORDER (woocommerceOrderId)
 * - Same order ID = grouped together
 * - Null/undefined order IDs = each treated as separate "order" (manually added)
 * - Main row shows booker information
 * - Sub-rows show individual ticket holder information
 */
export function groupAttendeesByOrder(attendees: Attendee[]): GroupedOrder[] {
  // Group by woocommerceOrderId
  // Use Map with special handling for null/undefined orderIds
  const grouped = new Map<string, Attendee[]>();

  for (const attendee of attendees) {
    // For manually added attendees (no orderID), treat each as separate group
    const key = attendee.woocommerceOrderId || `manual-${attendee.id}`;

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key)!.push(attendee);
  }

  // Transform each group into GroupedOrder
  const result: GroupedOrder[] = [];

  for (const [key, tickets] of grouped.entries()) {
    // Sort tickets by ticketId for consistency (or creation date as fallback)
    tickets.sort((a, b) => {
      if (a.ticketId && b.ticketId) {
        return a.ticketId.localeCompare(b.ticketId);
      }
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    const first = tickets[0]!;

    // Calculate check-in status based on ACTIVE tickets only
    // (exclude deleted/cancelled/refunded tickets from calculation)
    const activeTickets = tickets.filter(t =>
      t.orderStatus !== "deleted" &&
      t.orderStatus !== "cancelled" &&
      t.orderStatus !== "refunded"
    );
    const checkedInTickets = activeTickets.filter(t => t.checkedIn);
    const checkedInCount = checkedInTickets.length;
    // If no active tickets, consider "all checked in" to show Undo button (or disable)
    const allCheckedIn = activeTickets.length === 0 || checkedInCount === activeTickets.length;
    const someCheckedIn = checkedInCount > 0;

    let checkedInStatus: "all" | "partial" | "none";
    if (activeTickets.length === 0) {
      // All tickets deleted - show as "none" (will be handled by isInactiveOrder)
      checkedInStatus = "none";
    } else if (allCheckedIn) {
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

    // Use booker information from first ticket (all tickets in order have same booker)
    // Fallback: If booker fields are NULL, use first ticket holder's info
    const bookerFirstName = first.bookerFirstName || first.firstName;
    const bookerLastName = first.bookerLastName || first.lastName;
    const bookerEmail = first.bookerEmail || first.email;

    result.push({
      id: key,
      bookerFirstName,
      bookerLastName,
      bookerEmail,
      ticketCount: tickets.length,
      tickets,
      allCheckedIn,
      someCheckedIn,
      checkedInCount,
      checkedInStatus,
      isManuallyAdded,
      isLocallyModified,
      woocommerceOrderId: first.woocommerceOrderId,
      mostRecentCheckIn,
      eventId: first.eventId,
    });
  }

  // Sort by order ID for consistent ordering
  result.sort((a, b) => {
    const orderIdA = a.woocommerceOrderId || "";
    const orderIdB = b.woocommerceOrderId || "";
    return orderIdB.localeCompare(orderIdA); // Descending (newest orders first)
  });

  return result;
}
