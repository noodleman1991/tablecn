import "server-only";

import { db } from "@/db";
import { attendees, events, members, type Attendee, type OrderStatus } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrdersForProductCached } from "./woocommerce";
import { getCacheAge, setCachedData, getCachedData } from "./cache-utils";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { isMembersOnlyProduct } from "@/lib/event-patterns";

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
 * Helper: Extract ticket type from WooCommerce line item variation attributes
 */
function getTicketTypeFromLineItem(lineItem: any): string | null {
  // Method 1: Check variation_attributes meta (most reliable)
  const variationAttrsMeta = lineItem.meta_data?.find(
    (m: any) => m.key === '_variation_attributes' || m.key === 'variation_attributes'
  );
  if (variationAttrsMeta?.value) {
    const attrs = variationAttrsMeta.value;
    if (Array.isArray(attrs)) {
      const ticketTypeAttr = attrs.find(
        (a: any) => a.name?.toLowerCase().includes('ticket type') || a.key?.toLowerCase().includes('ticket-type')
      ) as { option?: string; value?: string } | undefined;
      if (ticketTypeAttr?.option || ticketTypeAttr?.value) {
        return ticketTypeAttr.option || ticketTypeAttr.value || null;
      }
    } else if (typeof attrs === 'object') {
      // Handle object format: {"pa_ticket-type": "standard"}
      for (const [key, value] of Object.entries(attrs)) {
        if (key.toLowerCase().includes('ticket-type') || key.toLowerCase().includes('ticket_type')) {
          return value as string;
        }
      }
    }
  }

  // Method 2: Parse from line item name suffix (e.g., "Event Name - Standard")
  const name = lineItem.name || '';
  const dashIndex = name.lastIndexOf(' - ');
  if (dashIndex !== -1) {
    const suffix = name.substring(dashIndex + 3).trim();
    // Validate it looks like a ticket type (not just random text)
    const knownTypes = ['standard', 'under 30', 'struggling financially', 'with donation', 'member', 'reduced'];
    if (knownTypes.some(t => suffix.toLowerCase().includes(t))) {
      return suffix;
    }
  }

  return null;
}

/**
 * Helper: Extract per-ticket attendee info from WooCommerce order
 * Handles the actual _ticket_data structure used by WooCommerce ticketing plugin
 */
function extractTicketAttendees(
  order: any,
  lineItem: any
): Array<{ firstName: string; lastName: string; email: string; ticketId: string; uid: string; bookerFirstName: string; bookerLastName: string; bookerEmail: string; ticketType: string | null }> {
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
    // Sort entries by key for deterministic ordering (alphabetical, matching original intent)
    // WooCommerce hash keys for a given field are consistent across all tickets of the same product
    const sortedEntries = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b));

    // Find email field (contains @ symbol) and normalize to lowercase
    const emailEntry = sortedEntries.find(([_, value]) =>
      typeof value === 'string' && value.includes('@')
    );
    const email = emailEntry ? emailEntry[1].toLowerCase() : '';

    // Find first and last name (non-email, non-empty fields)
    // Also filter out corrupted literal values like "first name" or "family name"
    const nameFields = sortedEntries
      .map(([_, v]) => v)
      .filter((v: string) => {
      if (!v || typeof v !== 'string') return false;
      if (v.includes('@')) return false;
      if (v.length >= 50) return false;
      const lower = v.toLowerCase().trim();
      // Skip corrupted placeholder values
      if (lower === 'first name' || lower === 'last name' || lower === 'family name') {
        console.warn(`[sync-attendees] Skipping corrupted field value: "${v}"`);
        return false;
      }
      return true;
    });

    const firstName = nameFields[0] || '';
    const lastName = nameFields[1] || '';

    // Find the actual WooCommerce ticket ID
    const ticketIdKey = `_ticket_id_for_${uid}`;
    const ticketIdMeta = lineItem.meta_data?.find((m: any) => m.key === ticketIdKey);
    const ticketId = ticketIdMeta?.value || `${lineItem.id}-${index}`;


    // Get ticket type from line item (same for all tickets in the line item)
    const ticketType = getTicketTypeFromLineItem(lineItem);

    attendees.push({
      firstName,
      lastName,
      email,
      ticketId,
      uid,
      // Booker information (person who placed the order)
      bookerFirstName: order.billing?.first_name || '',
      bookerLastName: order.billing?.last_name || '',
      bookerEmail: order.billing?.email?.toLowerCase() || '',
      ticketType,
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
        email: order.billing?.email?.toLowerCase() || '',
        ticketId: `${lineItem.id}-fallback-${i}`,
        uid: `fallback-${lineItem.id}-${i}`,
        // In fallback, booker and ticket holder are the same
        bookerFirstName: order.billing?.first_name || '',
        bookerLastName: order.billing?.last_name || '',
        bookerEmail: order.billing?.email?.toLowerCase() || '',
        ticketType: getTicketTypeFromLineItem(lineItem), // Still try to extract ticket type
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
  // FIXED: Convert event date to London timezone first, then create 23:00 in London,
  // then convert back to UTC for proper comparison
  const eventDateLondon = toZonedTime(eventDate, LONDON_TZ);

  // Create a date representing 23:00 London time on the event date
  // We construct a date string in ISO format with London's 23:00 time
  const cutoffLondonStr = `${eventDateLondon.getFullYear()}-${String(eventDateLondon.getMonth() + 1).padStart(2, '0')}-${String(eventDateLondon.getDate()).padStart(2, '0')}T23:00:00`;

  // fromZonedTime converts a "wall clock time in London" to the equivalent UTC instant
  const cutoffUTC = fromZonedTime(cutoffLondonStr, LONDON_TZ);

  // Get current time (already in UTC internally)
  const nowUTC = new Date();

  // If we're past the cutoff (23:00 London time on event day), skip WooCommerce sync
  if (nowUTC > cutoffUTC) {
    console.log(
      `[sync-attendees] Event ${eventData.name} has passed 23:00 London cutoff (cutoff: ${cutoffUTC.toISOString()}), using database records`,
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

  // Skip WooCommerce sync if synced recently (unless forceRefresh)
  // Note: We only cache sync timing, NOT attendee data - attendees always come fresh from DB
  if (!forceRefresh && cacheAge && cacheAge < 8 * 60 * 60) {
    const minutesOld = Math.floor(cacheAge / 60);
    console.log(
      `[sync-attendees] Skipping WooCommerce sync for ${eventData.name} (synced ${minutesOld} minutes ago)`,
    );

    return {
      synced: false,
      reason: "cached" as const,
      cacheAgeSeconds: cacheAge,
      // No cachedAttendees - always read fresh from database
    };
  }

  // Conditional date filtering: only for events before the cutoff
  // For events past the cutoff, we want ALL orders regardless of purchase date
  // Since we're here, we know we're before the cutoff (check above), so always filter
  const shouldFilterByDate = true;

  // Collect ALL product IDs to fetch orders from
  // This includes the primary product AND any merged product IDs
  const allProductIds = [
    eventData.woocommerceProductId,
    ...((eventData.mergedProductIds as string[]) || []),
  ].filter((id): id is string => id !== null && id !== undefined);

  console.log(
    `[sync-attendees] Fetching orders from ${allProductIds.length} product ID(s): ${allProductIds.join(", ")}`,
  );

  // Fetch orders from ALL product IDs with caching and error handling
  // Tag each order with which product it came from
  interface OrderWithSource {
    order: any;
    sourceProductId: string;
    isMembersOnlyProduct: boolean;
  }

  const allOrdersWithSource: OrderWithSource[] = [];

  for (const productId of allProductIds) {
    try {
      const orders = await getOrdersForProductCached(
        productId,
        shouldFilterByDate ? eventDate : undefined,
        forceRefresh
      );

      // Determine if this product is a members-only variant
      // We check based on event name patterns (since we don't have product names here)
      // For merged events, the members-only product ID is typically in mergedProductIds
      const isMembers = productId !== eventData.woocommerceProductId ||
        isMembersOnlyProduct(eventData.name);

      for (const order of orders) {
        allOrdersWithSource.push({
          order,
          sourceProductId: productId,
          isMembersOnlyProduct: isMembers && productId !== eventData.woocommerceProductId,
        });
      }

      console.log(
        `[sync-attendees] Found ${orders.length} orders for product ${productId}${isMembers && productId !== eventData.woocommerceProductId ? ' (members-only)' : ''}`,
      );
    } catch (error) {
      console.error(
        `[sync-attendees] Failed to fetch orders for product ${productId}:`,
        error instanceof Error ? error.message : error,
      );
      // Continue with other products - don't fail entirely
    }
  }

  if (allOrdersWithSource.length === 0) {
    console.log(
      `[sync-attendees] No orders found from any product, falling back to existing database records`,
    );
    return {
      synced: false,
      reason: "woocommerce_error",
      error: "No orders found from any product",
    };
  }

  console.log(
    `[sync-attendees] Found ${allOrdersWithSource.length} total orders for ${eventData.name}`,
  );

  let createdCount = 0;
  let updatedCount = 0;

  // Process each order (now with source product tracking)
  for (const { order, sourceProductId, isMembersOnlyProduct: isMembersProduct } of allOrdersWithSource) {
    // Process line items to get tickets per product
    const relevantLineItems = order.line_items?.filter((item: any) => {
      const itemProductId = item.product_id?.toString();
      // Match line items for this specific source product
      return itemProductId === sourceProductId;
    }) || [];

    if (relevantLineItems.length === 0) {
      console.warn(
        `[sync-attendees] Order ${order.id} has no matching line items for product ${sourceProductId}, skipping`,
      );
      continue;
    }

    // Map WooCommerce order status to our OrderStatus type
    const orderStatus: OrderStatus = (
      ["completed", "processing", "on-hold", "pending", "cancelled", "refunded", "failed"].includes(order.status)
        ? order.status
        : "completed"
    ) as OrderStatus;

    // Parse order date
    const orderDate = order.date_created ? new Date(order.date_created) : undefined;

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

        let existingAttendee = null;

        // Only check by ticketId AND eventId (matches UNIQUE constraint)
        // IMPORTANT: Must check both to prevent false positives across events
        if (ticket.ticketId && !ticket.ticketId.includes('fallback')) {
          const byTicketId = await db
            .select()
            .from(attendees)
            .where(
              and(
                eq(attendees.ticketId, ticket.ticketId),
                eq(attendees.eventId, eventId)
              )
            )
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

          // Determine the orderStatus to use:
          // - If attendee was soft-deleted via UI ("deleted"), preserve that status
          // - Otherwise, use the WooCommerce order status
          const effectiveOrderStatus = existingAttendee.orderStatus === "deleted"
            ? "deleted"  // Preserve soft-delete, don't overwrite
            : orderStatus; // Use WooCommerce status (completed, cancelled, refunded, etc.)

          // Update existing attendee (preserve check-in status and local modifications)
          await db
            .update(attendees)
            .set({
              email: ticket.email,
              firstName: ticket.firstName,
              lastName: ticket.lastName,
              ticketId: ticket.ticketId,
              woocommerceOrderId: order.id.toString(),
              woocommerceOrderDate: orderDate,
              orderStatus: effectiveOrderStatus, // Preserve soft-delete, sync WooCommerce statuses
              sourceProductId, // Track which product this ticket came from
              isMembersOnlyTicket: isMembersProduct, // Track if members-only ticket
              bookerFirstName: ticket.bookerFirstName,
              bookerLastName: ticket.bookerLastName,
              bookerEmail: ticket.bookerEmail,
              ticketType: ticket.ticketType, // Track ticket type (Standard, Under 30, etc.)
              // NOT updating: checkedIn, checkedInAt, locallyModified, manuallyAdded
            })
            .where(eq(attendees.id, existingAttendee.id));

          updatedCount++;
        } else {
          // Create new attendee with full tracking
          await db.insert(attendees).values({
            eventId,
            email: ticket.email,
            firstName: ticket.firstName,
            lastName: ticket.lastName,
            ticketId: ticket.ticketId,
            woocommerceOrderId: order.id.toString(),
            woocommerceOrderDate: orderDate,
            orderStatus, // Track order status
            sourceProductId, // Track source product
            isMembersOnlyTicket: isMembersProduct, // Track if members-only
            bookerFirstName: ticket.bookerFirstName,
            bookerLastName: ticket.bookerLastName,
            bookerEmail: ticket.bookerEmail,
            ticketType: ticket.ticketType, // Track ticket type (Standard, Under 30, etc.)
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

  // Cache only sync metadata (timing, counts) - NOT attendee data
  // Attendees should always be read fresh from database to reflect local changes (check-ins, edits)
  await setCachedData(
    cacheKey,
    {
      created: createdCount,
      updated: updatedCount,
      timestamp: Date.now(),
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
