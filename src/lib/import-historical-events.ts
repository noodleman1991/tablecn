import "server-only";

import { db } from "@/db";
import { events, attendees, members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getProducts, getOrdersForProduct, isEventProduct, extractEventDate } from "./woocommerce";
import { recalculateMembershipForMember } from "./calculate-membership";

interface ImportOptions {
  dryRun: boolean;
  monthsBack: number;
  markAsCheckedIn: boolean;
}

interface ImportedEvent {
  productId: string;
  productName: string;
  eventDate: Date;
  eventId?: string;
  attendeeCount: number;
  status: "created" | "skipped" | "error";
  reason?: string;
}

interface ImportedAttendee {
  email: string;
  firstName: string;
  lastName: string;
  orderId: string;
  eventName: string;
  status: "created" | "updated" | "skipped" | "error";
  reason?: string;
}

interface ImportResult {
  success: boolean;
  dryRun: boolean;
  executionTime: string;
  summary: {
    eventsProcessed: number;
    eventsCreated: number;
    eventsSkipped: number;
    attendeesCreated: number;
    attendeesUpdated: number;
    membersCreated: number;
    membersUpdated: number;
    errors: number;
  };
  events: ImportedEvent[];
  attendees: ImportedAttendee[];
  membershipSummary?: {
    total: number;
    active: number;
    inactive: number;
  };
}

/**
 * Import historical events and attendees from WooCommerce
 * - Fetches all event products from WooCommerce
 * - Creates event records for past events
 * - Fetches orders for each event
 * - Creates attendee records with order IDs
 * - Optionally marks all as checked in
 * - Recalculates memberships
 */
export async function importHistoricalEvents(
  options: ImportOptions
): Promise<ImportResult> {
  const startTime = Date.now();
  const { dryRun, monthsBack, markAsCheckedIn } = options;

  console.log(`[import] Starting historical import (dryRun: ${dryRun})...`);
  console.log(`[import] Looking back ${monthsBack} months`);

  const importedEvents: ImportedEvent[] = [];
  const importedAttendees: ImportedAttendee[] = [];
  const memberEmails = new Set<string>();

  try {
    // Step 1: Fetch all products from WooCommerce
    console.log("[import] Fetching WooCommerce products...");
    const products = await getProducts();
    console.log(`[import] Found ${products.length} total products`);

    // Step 2: Filter for event products with dates in the past
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsBack);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const eventProducts = products
      .filter((product) => {
        if (!isEventProduct(product)) return false;
        const eventDate = extractEventDate(product);
        if (!eventDate) return false;
        // Only include past events within the date range
        return eventDate < today && eventDate >= cutoffDate;
      })
      .sort((a, b) => {
        const dateA = extractEventDate(a)!;
        const dateB = extractEventDate(b)!;
        return dateA.getTime() - dateB.getTime();
      });

    console.log(`[import] Found ${eventProducts.length} historical event products`);

    // Step 3: Process each event product
    for (const product of eventProducts) {
      const productId = product.id.toString();
      const productName = product.name;
      const eventDate = extractEventDate(product)!;

      console.log(`[import] Processing: ${productName} (${eventDate.toDateString()})`);

      try {
        // Check if event already exists
        const existingEvent = await db
          .select()
          .from(events)
          .where(eq(events.woocommerceProductId, productId))
          .limit(1);

        let eventId: string;

        if (existingEvent.length > 0) {
          // Event already exists, skip creation
          eventId = existingEvent[0].id;
          importedEvents.push({
            productId,
            productName,
            eventDate,
            eventId,
            attendeeCount: 0,
            status: "skipped",
            reason: "already_exists",
          });
          console.log(`[import] Event already exists: ${productName}`);
        } else {
          // Create new event
          if (!dryRun) {
            const [newEvent] = await db.insert(events).values({
              name: productName,
              eventDate: eventDate,
              woocommerceProductId: productId,
            }).returning();
            eventId = newEvent.id;
          } else {
            eventId = "dry-run-id";
          }

          importedEvents.push({
            productId,
            productName,
            eventDate,
            eventId,
            attendeeCount: 0, // Will be updated below
            status: "created",
          });
          console.log(`[import] ${dryRun ? "[DRY RUN]" : ""} Created event: ${productName}`);
        }

        // Step 4: Fetch orders for this event product
        console.log(`[import] Fetching orders for ${productName}...`);
        const orders = await getOrdersForProduct(productId, eventDate);
        console.log(`[import] Found ${orders.length} orders`);

        let createdCount = 0;
        let updatedCount = 0;

        // Step 5: Process each order
        for (const order of orders) {
          const email = order.billing?.email?.toLowerCase().trim() || "";
          const firstName = order.billing?.first_name || "";
          const lastName = order.billing?.last_name || "";
          const orderId = order.id.toString();

          if (!email) {
            console.warn(`[import] Order ${orderId} has no email, skipping`);
            importedAttendees.push({
              email: "no-email",
              firstName,
              lastName,
              orderId,
              eventName: productName,
              status: "error",
              reason: "no_email",
            });
            continue;
          }

          // Check if attendee already exists for this order
          const existingAttendee = await db
            .select()
            .from(attendees)
            .where(eq(attendees.woocommerceOrderId, orderId))
            .limit(1);

          if (existingAttendee.length > 0) {
            // Update existing attendee
            if (!dryRun) {
              await db
                .update(attendees)
                .set({
                  email,
                  firstName,
                  lastName,
                  checkedIn: markAsCheckedIn ? true : existingAttendee[0].checkedIn,
                  checkedInAt: markAsCheckedIn ? eventDate : existingAttendee[0].checkedInAt,
                })
                .where(eq(attendees.id, existingAttendee[0].id));
            }

            updatedCount++;
            importedAttendees.push({
              email,
              firstName,
              lastName,
              orderId,
              eventName: productName,
              status: "updated",
            });
          } else {
            // Add validation before creating attendee
            const eventDateObj = new Date(eventData.eventDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            eventDateObj.setHours(0, 0, 0, 0);

            const shouldAutoCheckIn = markAsCheckedIn && (eventDateObj < today);

            // Create new attendee
            if (!dryRun) {
              await db.insert(attendees).values({
                eventId,
                email,
                firstName,
                lastName,
                woocommerceOrderId: orderId,
                checkedIn: shouldAutoCheckIn,
                checkedInAt: shouldAutoCheckIn ? eventDateObj : null,
              });
            }

            createdCount++;
            importedAttendees.push({
              email,
              firstName,
              lastName,
              orderId,
              eventName: productName,
              status: "created",
            });
          }

          memberEmails.add(email);

          // Upsert member record
          if (!dryRun) {
            await upsertMember(email, firstName, lastName);
          }
        }

        // Update event attendee count
        const eventIndex = importedEvents.findIndex(e => e.productId === productId);
        if (eventIndex !== -1) {
          importedEvents[eventIndex].attendeeCount = createdCount + updatedCount;
        }

        console.log(
          `[import] ${dryRun ? "[DRY RUN]" : ""} Processed ${orders.length} orders: ${createdCount} created, ${updatedCount} updated`
        );

      } catch (error) {
        console.error(`[import] Error processing event ${productName}:`, error);
        importedEvents.push({
          productId,
          productName,
          eventDate,
          attendeeCount: 0,
          status: "error",
          reason: error instanceof Error ? error.message : "unknown_error",
        });
      }
    }

    // Step 6: Recalculate memberships
    let membershipSummary;
    if (!dryRun) {
      console.log("[import] Recalculating memberships...");
      const allMembers = await db.select().from(members);

      const membershipResults = [];
      for (const member of allMembers) {
        try {
          const result = await recalculateMembershipForMember(member.id);
          membershipResults.push(result);
        } catch (error) {
          console.error(`[import] Error recalculating for ${member.email}:`, error);
        }
      }

      const activeCount = membershipResults.filter(m => m.isActiveMember).length;
      membershipSummary = {
        total: membershipResults.length,
        active: activeCount,
        inactive: membershipResults.length - activeCount,
      };

      console.log(`[import] Memberships: ${activeCount} active, ${membershipSummary.inactive} inactive`);
    }

    const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[import] Import complete in ${executionTime}s`);

    return {
      success: true,
      dryRun,
      executionTime: `${executionTime}s`,
      summary: {
        eventsProcessed: eventProducts.length,
        eventsCreated: importedEvents.filter(e => e.status === "created").length,
        eventsSkipped: importedEvents.filter(e => e.status === "skipped").length,
        attendeesCreated: importedAttendees.filter(a => a.status === "created").length,
        attendeesUpdated: importedAttendees.filter(a => a.status === "updated").length,
        membersCreated: memberEmails.size,
        membersUpdated: 0,
        errors: importedEvents.filter(e => e.status === "error").length +
                importedAttendees.filter(a => a.status === "error").length,
      },
      events: importedEvents,
      attendees: importedAttendees,
      membershipSummary,
    };

  } catch (error) {
    console.error("[import] Fatal error:", error);
    const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);

    return {
      success: false,
      dryRun,
      executionTime: `${executionTime}s`,
      summary: {
        eventsProcessed: 0,
        eventsCreated: 0,
        eventsSkipped: 0,
        attendeesCreated: 0,
        attendeesUpdated: 0,
        membersCreated: 0,
        membersUpdated: 0,
        errors: 1,
      },
      events: importedEvents,
      attendees: importedAttendees,
    };
  }
}

/**
 * Ensure a member record exists for an email
 * Creates if doesn't exist, updates name if changed
 */
async function upsertMember(
  email: string,
  firstName: string,
  lastName: string
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

// ============================================================================
// CSV-Based Historical Event Creation
// ============================================================================

import { parse } from "csv-parse/sync";
import fs from "fs";

interface CSVRow {
  "Order Number": string;
  "Order Date": string;
  "Item Name": string;
  "Order Status": string;
  "Quantity (- Refund)": string;
}

/**
 * Clean event name by removing pricing tier suffixes
 * (Copied from import-from-csv.ts to ensure consistency)
 */
function cleanEventName(itemName: string): string {
  const pricingTiers = [
    " - Standard (includes Community Member)",
    " - Standard",
    " - Under 30",
    " - Under 25",
    " - Struggling Financially",
    " - Supporter",
    " - With ticket for Power Station screening",
    " - Community Member",
    " - Non-member",
    " - Kairos Club Member",
    " - Member",
    " - Student or Unwaged",
    " - All tickets",
    " - I Have a Credit",
    " - Waiting List Payment Link",
    " - Payment Link",
    " - Members",
    " - Non-members",
    " - Low",
    " - Medium",
    " - High",
    " - Workshop participant",
    " - Games Social only",
    " - Changing Hearts and Minds workshop attendee",
    " - Standard Fee for Individual",
    " - Standard Fee plus Donation",
    " - Workshop attendee",
    " - Free with Talk",
    " - All",
  ];

  let cleaned = itemName;
  for (const tier of pricingTiers) {
    cleaned = cleaned.replace(tier, "");
  }

  return cleaned.trim();
}

export interface CreateHistoricalEventsResult {
  success: boolean;
  totalUnique: number;
  eventsCreated: number;
  eventsSkipped: number;
  errors: string[];
  eventList?: Array<{ name: string; date: string; created: boolean }>;
}

/**
 * Creates historical event records from CSV data
 * Extracts unique event names and uses earliest order date as event date
 */
export async function createHistoricalEventsFromCSV(
  csvFilePath: string = "orders-2025-12-05-21-21-50.csv"
): Promise<CreateHistoricalEventsResult> {
  const result: CreateHistoricalEventsResult = {
    success: true,
    totalUnique: 0,
    eventsCreated: 0,
    eventsSkipped: 0,
    errors: [],
    eventList: [],
  };

  try {
    console.log(`[historical-events] Reading CSV from ${csvFilePath}...`);

    // Read CSV file
    const fileContent = fs.readFileSync(csvFilePath, "utf-8");
    const rows = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
    }) as CSVRow[];

    console.log(`[historical-events] Found ${rows.length} rows in CSV`);

    // Group by cleaned event name, track earliest date and order count
    const eventMap = new Map<
      string,
      {
        firstOrderDate: Date;
        originalName: string;
        orderCount: number;
      }
    >();

    for (const row of rows) {
      // Only process completed or processing orders
      if (
        row["Order Status"] !== "Processing" &&
        row["Order Status"] !== "Completed"
      ) {
        continue;
      }

      const itemName = row["Item Name"]?.trim();
      if (!itemName) continue;

      const quantity = parseInt(row["Quantity (- Refund)"] || "0");
      if (quantity <= 0) continue;

      const cleanedName = cleanEventName(itemName);
      const orderDate = new Date(row["Order Date"]);

      if (!eventMap.has(cleanedName)) {
        eventMap.set(cleanedName, {
          firstOrderDate: orderDate,
          originalName: itemName,
          orderCount: 1,
        });
      } else {
        const existing = eventMap.get(cleanedName)!;
        existing.orderCount++;

        // Keep the earliest order date
        if (orderDate < existing.firstOrderDate) {
          existing.firstOrderDate = orderDate;
        }
      }
    }

    result.totalUnique = eventMap.size;
    console.log(
      `[historical-events] Found ${eventMap.size} unique events from CSV`
    );

    // Get existing events from database
    const existingEvents = await db.select().from(events);
    const existingNames = new Set(
      existingEvents.map((e) => e.name.toLowerCase())
    );

    console.log(
      `[historical-events] Database has ${existingEvents.length} existing events`
    );

    // Create missing events
    const sortedEvents = Array.from(eventMap.entries()).sort(
      ([, a], [, b]) => a.firstOrderDate.getTime() - b.firstOrderDate.getTime()
    );

    for (const [cleanedName, data] of sortedEvents) {
      if (existingNames.has(cleanedName.toLowerCase())) {
        console.log(`[historical-events] [skip] Event already exists: ${cleanedName}`);
        result.eventsSkipped++;
        result.eventList?.push({
          name: cleanedName,
          date: data.firstOrderDate.toISOString(),
          created: false,
        });
        continue;
      }

      try {
        await db.insert(events).values({
          name: cleanedName,
          eventDate: data.firstOrderDate,
          woocommerceProductId: null,
        });

        console.log(
          `[historical-events] [create] ${cleanedName} (date: ${data.firstOrderDate.toISOString()}, orders: ${data.orderCount})`
        );
        result.eventsCreated++;
        result.eventList?.push({
          name: cleanedName,
          date: data.firstOrderDate.toISOString(),
          created: true,
        });
      } catch (error) {
        const errorMsg = `Failed to create event "${cleanedName}": ${error instanceof Error ? error.message : "Unknown error"}`;
        console.error(`[historical-events] ${errorMsg}`);
        result.errors.push(errorMsg);
      }
    }

    console.log(`[historical-events] Summary:`);
    console.log(`  - Total unique events: ${result.totalUnique}`);
    console.log(`  - Events created: ${result.eventsCreated}`);
    console.log(`  - Events skipped (already exist): ${result.eventsSkipped}`);
    console.log(`  - Errors: ${result.errors.length}`);

    return result;
  } catch (error) {
    console.error("[historical-events] Fatal error:", error);
    result.success = false;
    result.errors.push(
      error instanceof Error ? error.message : "Unknown error"
    );
    return result;
  }
}
