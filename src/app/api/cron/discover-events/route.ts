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

/**
 * Cron job to auto-discover events from WooCommerce
 * Runs hourly to check for new event products
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

      // Check if event already exists
      const existing = await db
        .select()
        .from(events)
        .where(eq(events.woocommerceProductId, product.id.toString()))
        .limit(1);

      if (existing.length > 0) {
        // Event already exists, skip
        skippedCount++;
        continue;
      }

      // Create new event
      await db.insert(events).values({
        name: product.name,
        eventDate,
        woocommerceProductId: product.id.toString(),
      });

      console.log(
        `[discover-events] Created event: ${product.name} on ${eventDate.toISOString()}`,
      );
      createdCount++;
    }

    return NextResponse.json({
      success: true,
      totalProducts: products.length,
      eventProducts: eventProducts.length,
      created: createdCount,
      skipped: skippedCount,
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
