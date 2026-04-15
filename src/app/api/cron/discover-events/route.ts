import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { events } from "@/db/schema";
import { env } from "@/env";
import {
  getProducts,
  isEventProduct,
  extractEventDate,
  isQualifyingEventProduct,
  getProductStatus,
} from "@/lib/woocommerce";
import { and, eq, gt, isNull, isNotNull } from "drizzle-orm";
import { mergeDuplicateEvents } from "@/lib/merge-events";
import { isMembersOnlyProduct } from "@/lib/event-patterns";

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
export const maxDuration = 800;

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
      const isQualifyingEvent = isQualifyingEventProduct(product);

      // Atomic upsert. isQualifyingEvent is deliberately omitted from the
      // on-conflict SET clause: once a row exists, its qualifying status is
      // sticky (manual DB fixes and the one-time backfill must survive).
      const result = await db
        .insert(events)
        .values({
          name: product.name,
          eventDate,
          woocommerceProductId: productId,
          isMembersOnlyProduct: isMembersOnly,
          isQualifyingEvent,
        })
        .onConflictDoUpdate({
          target: events.woocommerceProductId,
          set: {
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

    // Reconcile upcoming events against WooCommerce. getProducts() is filtered
    // to status=publish; anything currently-active in our DB that didn't show
    // up there might be draft/trash/deleted. Probe each and soft-cancel if so.
    // Past events are intentionally untouched.
    const reconcileStart = Date.now();
    const ingestedIds = new Set(eventProducts.map((p: any) => p.id.toString()));
    const upcoming = await db
      .select({ id: events.id, name: events.name, woocommerceProductId: events.woocommerceProductId })
      .from(events)
      .where(
        and(
          isNull(events.mergedIntoEventId),
          eq(events.status, "active"),
          gt(events.eventDate, new Date()),
          isNotNull(events.woocommerceProductId),
        ),
      );

    let cancelledCount = 0;
    let probeErrorCount = 0;
    for (const row of upcoming) {
      if (ingestedIds.has(row.woocommerceProductId!)) continue;

      const wcStatus = await getProductStatus(row.woocommerceProductId!);
      if (wcStatus === "draft" || wcStatus === "trash" || wcStatus === "deleted") {
        await db
          .update(events)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(events.id, row.id));
        console.log(`[discover-events] Cancelled ${row.name} (WC product ${row.woocommerceProductId}) — WC status: ${wcStatus}`);
        cancelledCount++;
      } else if (wcStatus === "error") {
        probeErrorCount++;
      }
    }
    console.log(
      `[discover-events] Reconciled ${upcoming.length} upcoming events in ${Date.now() - reconcileStart}ms — ${cancelledCount} cancelled, ${probeErrorCount} probe errors`,
    );

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
      reconcile: {
        upcoming: upcoming.length,
        cancelled: cancelledCount,
        probeErrors: probeErrorCount,
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
