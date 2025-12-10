import "server-only";

import { db } from "@/db";
import { attendees, events, members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrdersForProductCached } from "./woocommerce";
import { getCacheAge, setCachedData } from "./cache-utils";

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

  if (event.length === 0) {
    throw new Error(`Event not found: ${eventId}`);
  }

  const eventData = event[0];
  const eventDate = new Date(eventData.eventDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // If event is in the past, skip WooCommerce sync
  if (eventDate < today) {
    console.log(
      `[sync-attendees] Event ${eventData.name} is in the past, using database records`,
    );
    return {
      synced: false,
      reason: "past_event",
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
    return {
      synced: false,
      reason: "cached",
      cacheAgeSeconds: cacheAge,
    };
  }

  // Conditional date filtering: only for future/today events
  // For past events, we want ALL orders regardless of purchase date
  const shouldFilterByDate = eventDate >= today;

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
    // Extract customer info
    const email = order.billing?.email || "";
    const firstName = order.billing?.first_name || "";
    const lastName = order.billing?.last_name || "";

    if (!email) {
      console.warn(
        `[sync-attendees] Order ${order.id} has no email, skipping`,
      );
      continue;
    }

    // Check if attendee already exists
    const existing = await db
      .select()
      .from(attendees)
      .where(eq(attendees.woocommerceOrderId, order.id.toString()))
      .limit(1);

    if (existing.length > 0) {
      // Update existing attendee (in case name changed)
      // IMPORTANT: Preserve check-in status - don't overwrite manual check-ins
      await db
        .update(attendees)
        .set({
          email,
          firstName,
          lastName,
          // NOT updating: checkedIn, checkedInAt
        })
        .where(eq(attendees.id, existing[0].id));

      updatedCount++;
    } else {
      // Create new attendee
      await db.insert(attendees).values({
        eventId,
        email,
        firstName,
        lastName,
        woocommerceOrderId: order.id.toString(),
        checkedIn: false,
      });

      createdCount++;
    }

    // Ensure member record exists
    await upsertMember(email, firstName, lastName);
  }

  console.log(
    `[sync-attendees] Sync complete: ${createdCount} created, ${updatedCount} updated`,
  );

  // Cache the sync result
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
 */
async function upsertMember(
  email: string,
  firstName: string,
  lastName: string,
) {
  const existing = await db
    .select()
    .from(members)
    .where(eq(members.email, email))
    .limit(1);

  if (existing.length === 0) {
    // Create new member
    await db.insert(members).values({
      email,
      firstName,
      lastName,
      isActiveMember: false,
      totalEventsAttended: 0,
    });
  } else {
    // Update name if provided and different
    if (firstName || lastName) {
      await db
        .update(members)
        .set({
          firstName: firstName || existing[0].firstName,
          lastName: lastName || existing[0].lastName,
        })
        .where(eq(members.id, existing[0].id));
    }
  }
}

/**
 * Get attendees for an event (no sync, just fetch from DB)
 */
export async function getAttendeesForEvent(eventId: string) {
  return await db.select().from(attendees).where(eq(attendees.eventId, eventId));
}
