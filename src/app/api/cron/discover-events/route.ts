import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { events } from "@/db/schema";
import { env } from "@/env";
import {
  getProducts,
  isEventProduct,
  extractEventDate,
} from "@/lib/woocommerce";
import { eq } from "drizzle-orm";
import { mergeDuplicateEvents } from "@/lib/merge-events";

// Patterns that indicate a members-only event product
const MEMBERS_ONLY_PATTERNS = [
  "members only",
  "members link",
  "member only",
  "- members",
  "members -",
];

/**
 * Check if a product name indicates it's a members-only event
 */
function isMembersOnlyProduct(productName: string): boolean {
  const lowerName = productName.toLowerCase();
  return MEMBERS_ONLY_PATTERNS.some(pattern => lowerName.includes(pattern));
}

/**
 * Cron job to auto-discover events from WooCommerce
 * Runs hourly to check for new event products
 *
 * FIXED: Uses atomic upsert to prevent race conditions when multiple
 * cron jobs run concurrently. Also updates existing events with latest
 * WooCommerce data (name, date changes).
 *
 * Vercel Cron: https://vercel.com/docs/cron-jobs
 * Add to vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/discover-events",
 *     "schedule": "0 * * * *"
 *   }]
 * }
 */
export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[discover-events] Starting event discovery...");

    // Fetch all products from WooCommerce
    const products = await getProducts();
    console.log(`[discover-events] Found ${products.length} total products`);

    // Filter for event products
    const eventProducts = products.filter(isEventProduct);
    console.log(
      `[discover-events] Identified ${eventProducts.length} event products`,
    );

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    // Process each event product
    for (const product of eventProducts) {
      const eventDate = extractEventDate(product);

      if (!eventDate) {
        console.warn(
          `[discover-events] Could not extract date from product: ${product.name}`,
        );
        skippedCount++;
        continue;
      }

      const productId = product.id.toString();
      const isMembersOnly = isMembersOnlyProduct(product.name);

      // Use atomic upsert to prevent race conditions
      // This will INSERT if not exists, or UPDATE if exists
      const result = await db
        .insert(events)
        .values({
          name: product.name,
          eventDate,
          woocommerceProductId: productId,
          isMembersOnlyProduct: isMembersOnly,
        })
        .onConflictDoUpdate({
          target: events.woocommerceProductId,
          set: {
            // Update name and date from WooCommerce (in case they changed)
            name: product.name,
            eventDate,
            isMembersOnlyProduct: isMembersOnly,
            updatedAt: new Date(),
          },
        })
        .returning({ id: events.id, createdAt: events.createdAt, updatedAt: events.updatedAt });

      // Determine if this was a create or update based on timestamps
      const record = result[0];
      if (record) {
        const wasJustCreated = record.createdAt && record.updatedAt &&
          Math.abs(record.createdAt.getTime() - record.updatedAt.getTime()) < 1000;

        if (wasJustCreated) {
          console.log(
            `[discover-events] Created event: ${product.name} on ${eventDate.toISOString()}${isMembersOnly ? ' (members-only)' : ''}`,
          );
          createdCount++;
        } else {
          // It was an update
          updatedCount++;
        }
      }
    }

    console.log(`[discover-events] Processed: ${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped`);

    // Merge any duplicate events (standard + members-only pairs)
    console.log("[discover-events] Starting merge process...");
    const mergeResult = await mergeDuplicateEvents();

    return NextResponse.json({
      success: true,
      totalProducts: products.length,
      eventProducts: eventProducts.length,
      events: {
        created: createdCount,
        updated: updatedCount,
        skipped: skippedCount,
      },
      merges: {
        groupsFound: mergeResult.groupsFound,
        groupsMerged: mergeResult.groupsMerged,
        groupsFailed: mergeResult.groupsFailed,
        eventsMerged: mergeResult.totalEventsMerged,
        attendeesAffected: mergeResult.totalAttendeesAffected,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[discover-events] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to discover events",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
