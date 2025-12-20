import "server-only";

import { db } from "@/db";
import { attendees, events, members, type Attendee } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrdersForProductCached } from "./woocommerce";
import { getCacheAge, setCachedData, getCachedData } from "./cache-utils";
import { toZonedTime } from "date-fns-tz";

/**
 * Helper: Find a meta value in WooCommerce meta_data array
 */
function findMetaValue(metaData: any[], key: string): string | null {
  const meta = metaData?.find((m: any) => m.key === key);
  return meta?.value || null;
}

interface TicketFields {
  [key: string]: string;
}

interface TicketDataEntry {
  uid: string;
  index: number;
  fields: TicketFields;
  order_item_id: number;
}

/**
 * Helper: Extract per-ticket attendee info from WooCommerce order
 * Handles the actual _ticket_data structure used by WooCommerce ticketing plugin
 */
function extractTicketAttendees(
  order: any,
  lineItem: any
): Array<{ firstName: string; lastName: string; email: string; ticketId: string; uid: string }> {
  const attendees = [];

  // Find _ticket_data in line item meta_data
  const ticketDataMeta = lineItem.meta_data?.find((m: any) => m.key === '_ticket_data');

  if (!ticketDataMeta || !Array.isArray(ticketDataMeta.value)) {
    console.warn(`[sync-attendees] No _ticket_data found for line item ${lineItem.id}`);
    return [];
  }

  const ticketDataArray: TicketDataEntry[] = ticketDataMeta.value;

  for (const ticketData of ticketDataArray) {
    const { uid, index, fields } = ticketData;

    // Extract field values from hashed keys
    // Based on observed pattern from WooCommerce data:
    // - First field (alphabetically by hash) tends to be first name
    // - Second field tends to be last name
    // - Third field tends to be email
    // - Fourth field (if exists) is membership number
    const fieldValues = Object.values(fields);
    const fieldEntries = Object.entries(fields);

    // Find email field (contains @ symbol)
    const emailEntry = fieldEntries.find(([_, value]) =>
      typeof value === 'string' && value.includes('@')
    );
    const email = emailEntry ? emailEntry[1] : '';

    // Find first and last name (non-email, non-empty fields)
    const nameFields = fieldValues.filter((v: string) =>
      v && typeof v === 'string' && !v.includes('@') && v.length < 50
    );

    const firstName = nameFields[0] || '';
    const lastName = nameFields[1] || '';

    // Find the actual WooCommerce ticket ID
    const ticketIdKey = `_ticket_id_for_${uid}`;
    const ticketIdMeta = lineItem.meta_data?.find((m: any) => m.key === ticketIdKey);
    const ticketId = ticketIdMeta?.value || `${lineItem.id}-${index}`;


    attendees.push({
      firstName,
      lastName,
      email,
      ticketId,
      uid,
    });
  }

  // Fallback: if no tickets found, create one from billing info
  if (attendees.length === 0) {
    const quantity = parseInt(lineItem.quantity) || 1;
    console.warn(`[sync-attendees] No ticket data extracted, falling back to billing info for ${quantity} ticket(s)`);

    for (let i = 0; i < quantity; i++) {
      attendees.push({
        firstName: order.billing?.first_name || '',
        lastName: order.billing?.last_name || '',
        email: order.billing?.email || '',
        ticketId: `${lineItem.id}-fallback-${i}`,
        uid: `fallback-${lineItem.id}-${i}`,
      });
    }
  }

  return attendees;
}

/**
 * Smart sync logic for event attendees
 * - For past events: Use database records (no WooCommerce sync)
 * - For today/future events: Sync from WooCommerce (with caching)
 * @param eventId - The event ID to sync
 * @param forceRefresh - Force refresh from WooCommerce, bypassing cache
 */
export async function syncAttendeesForEvent(
  eventId: string,
  forceRefresh: boolean = false
) {
  // Get the event
  const event = await db
    .select()
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  const eventData = event[0];
  if (!eventData) {
    throw new Error(`Event not found: ${eventId}`);
  }

  // Calculate cutoff time: 23:00 London time on the event date
  // After this time, the attendee list is "frozen" and we only use database records
  const eventDate = new Date(eventData.eventDate);
  const LONDON_TZ = 'Europe/London';

  // Create cutoff: event date at 23:00 London time
  const cutoffDate = new Date(eventDate);
  cutoffDate.setHours(23, 0, 0, 0);
  const cutoffLondon = toZonedTime(cutoffDate, LONDON_TZ);

  // Get current time in London
  const nowLondon = toZonedTime(new Date(), LONDON_TZ);

  // If we're past the cutoff (23:00 London time on event day), skip WooCommerce sync
  if (nowLondon > cutoffLondon) {
    console.log(
      `[sync-attendees] Event ${eventData.name} has passed 23:00 London cutoff, using database records`,
    );
    return {
      synced: false,
      reason: "past_cutoff",
    };
  }

  // Event is today or in the future, sync from WooCommerce
  console.log(
    `[sync-attendees] Syncing attendees for ${eventData.name} from WooCommerce...`,
  );

  if (!eventData.woocommerceProductId) {
    console.warn(
      `[sync-attendees] Event ${eventData.name} has no WooCommerce product ID`,
    );
    return {
      synced: false,
      reason: "no_product_id",
    };
  }

  // Check cache age for this event
  const cacheKey = `sync:event:${eventId}`;
  const cacheAge = await getCacheAge(cacheKey);

  // Skip sync if cached recently (unless forceRefresh)
  if (!forceRefresh && cacheAge && cacheAge < 8 * 60 * 60) {
    const minutesOld = Math.floor(cacheAge / 60);
    console.log(
      `[sync-attendees] Using cached sync result for ${eventData.name} (${minutesOld} minutes old)`,
    );

    // Retrieve cached data including attendees
    const cachedData = await getCachedData<{
      created: number;
      updated: number;
      timestamp: number;
      attendees?: Attendee[];
    }>(cacheKey);

    return {
      synced: false,
      reason: "cached" as const,
      cacheAgeSeconds: cacheAge,
      cachedAttendees: cachedData?.attendees,
    };
  }

  // Conditional date filtering: only for events before the cutoff
  // For events past the cutoff, we want ALL orders regardless of purchase date
  // Since we're here, we know we're before the cutoff (check above), so always filter
  const shouldFilterByDate = true;

  // Fetch orders from WooCommerce with caching and error handling
  let orders;
  try {
    orders = await getOrdersForProductCached(
      eventData.woocommerceProductId,
      shouldFilterByDate ? eventDate : undefined,
      forceRefresh
    );
    console.log(
      `[sync-attendees] Found ${orders.length} orders for ${eventData.name}`,
    );
  } catch (error) {
    console.error(
      `[sync-attendees] Failed to fetch orders from WooCommerce for ${eventData.name}:`,
      error instanceof Error ? error.message : error,
    );
    console.log(
      `[sync-attendees] Falling back to existing database records`,
    );
    return {
      synced: false,
      reason: "woocommerce_error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  let createdCount = 0;
  let updatedCount = 0;

  // Process each order
  for (const order of orders) {
    // Process line items to get tickets per product
    const relevantLineItems = order.line_items?.filter((item: any) => {
      const itemProductId = item.product_id?.toString();
      // For variable products, line items have the parent product_id set correctly
      // The variation_id is just metadata about which variant (e.g., "Standard", "Under 30")
      // was selected, and will never match the product ID
      return itemProductId === eventData.woocommerceProductId;
    }) || [];

    if (relevantLineItems.length === 0) {
      console.warn(
        `[sync-attendees] Order ${order.id} has no matching line items, skipping`,
      );
      continue;
    }

    // Process each line item
    for (const lineItem of relevantLineItems) {
      // Extract all tickets from this line item
      const ticketsFromLineItem = extractTicketAttendees(order, lineItem);

      // Create/update attendee for each ticket
      for (const ticket of ticketsFromLineItem) {
        // Skip if no email
        if (!ticket.email) {
          console.warn(`[sync-attendees] Ticket ${ticket.ticketId} has no email, skipping`);
          continue;
        }

        // TICKET-BASED DUPLICATE DETECTION
        // TicketId is the unique identifier - if it exists and matches, it's the same ticket
        // If ticketId doesn't exist in database, this is a NEW ticket (create it)
        //
        // IMPORTANT: Do NOT match by email+name - same person can legitimately buy multiple tickets
        // Example: maria-goddard@live.co.uk bought ticket 17257 on Nov 4 and ticket 17915 on Dec 6
        // These are 2 separate purchases, not duplicates!
        //
        // Previous bug: We were matching by (email + firstName + lastName) which incorrectly
        // merged separate ticket purchases for the same person, causing data loss.

        let existingAttendee = null;

        // Only check by ticketId (the unique identifier)
        if (ticket.ticketId && !ticket.ticketId.includes('fallback')) {
          const byTicketId = await db
            .select()
            .from(attendees)
            .where(eq(attendees.woocommerceOrderId, ticket.ticketId))
            .limit(1);
          existingAttendee = byTicketId[0];
        }

        // If not found by ticketId, this is a NEW ticket → create it
        // No fallback to email+name matching (that was causing the bug)

        if (existingAttendee) {
          // Skip update if locally modified
          if (existingAttendee.locallyModified) {
            console.log(`[sync-attendees] Attendee ${existingAttendee.id} is locally modified, skipping`);
            continue;
          }

          // Update existing attendee (preserve check-in status and local modifications)
          await db
            .update(attendees)
            .set({
              email: ticket.email,
              firstName: ticket.firstName,
              lastName: ticket.lastName,
              woocommerceOrderId: ticket.ticketId, // Update ticketId in case it changed
              // NOT updating: checkedIn, checkedInAt, locallyModified, manuallyAdded
            })
            .where(eq(attendees.id, existingAttendee.id));

          updatedCount++;
        } else {
          // Create new attendee
          await db.insert(attendees).values({
            eventId,
            email: ticket.email,
            firstName: ticket.firstName,
            lastName: ticket.lastName,
            woocommerceOrderId: ticket.ticketId,
            manuallyAdded: false,
            locallyModified: false,
            checkedIn: false,
          });

          createdCount++;
        }

        // Ensure member record exists
        await upsertMember(ticket.email, ticket.firstName, ticket.lastName);
      }
    }
  }

  console.log(
    `[sync-attendees] Sync complete: ${createdCount} created, ${updatedCount} updated`,
  );

  // Query the synced attendees to cache them
  const syncedAttendees = await db
    .select()
    .from(attendees)
    .where(eq(attendees.eventId, eventId))
    .orderBy(attendees.email);

  // Cache the sync result including attendee data
  await setCachedData(
    cacheKey,
    {
      created: createdCount,
      updated: updatedCount,
      timestamp: Date.now(),
      attendees: syncedAttendees,
    },
    8 * 60 * 60
  );

  return {
    synced: true,
    created: createdCount,
    updated: updatedCount,
  };
}

/**
 * Ensure a member record exists for an email
 * Creates if doesn't exist, updates name if changed
 * Uses atomic onConflictDoUpdate to avoid race conditions
 */
async function upsertMember(
  email: string,
  firstName: string,
  lastName: string,
) {
  await db
    .insert(members)
    .values({
      email,
      firstName,
      lastName,
      isActiveMember: false,
      totalEventsAttended: 0,
    })
    .onConflictDoUpdate({
      target: members.email,
      set: {
        firstName,
        lastName,
      },
    });
}

/**
 * Get attendees for an event (no sync, just fetch from DB)
 */
export async function getAttendeesForEvent(eventId: string) {
  return await db.select().from(attendees).where(eq(attendees.eventId, eventId));
}
