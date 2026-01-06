// Set server environment
process.env.NEXT_RUNTIME = 'nodejs';

import { db } from "@/db";
import { attendees, events } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

// Import server action instead of sync function directly
import { refreshAttendeesForEvent } from "@/app/actions";

async function cleanupAndResync() {
  console.log("🧹 Starting cleanup and resync...\n");

  // Get all events with WooCommerce product IDs
  const eventList = await db
    .select()
    .from(events)
    .where(sql`woocommerce_product_id IS NOT NULL`)
    .orderBy(events.eventDate);

  console.log(`Found ${eventList.length} events with WooCommerce product IDs\n`);

  let totalDeleted = 0;
  let totalCreated = 0;
  let totalUpdated = 0;

  for (const event of eventList) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📅 Event: ${event.name}`);
    console.log(`   Date: ${event.eventDate}`);
    console.log(`   Product ID: ${event.woocommerceProductId}`);

    // Count existing attendees
    const existing = await db
      .select()
      .from(attendees)
      .where(eq(attendees.eventId, event.id));

    console.log(`   Current attendees: ${existing.length}`);

    // Delete all attendees for this event
    await db.delete(attendees).where(eq(attendees.eventId, event.id));
    totalDeleted += existing.length;
    console.log(`   ✓ Deleted ${existing.length} attendees`);

    // Force fresh sync from WooCommerce
    try {
      const result = await refreshAttendeesForEvent(event.id);

      if (result.success) {
        // Get the new count
        const newAttendees = await db
          .select()
          .from(attendees)
          .where(eq(attendees.eventId, event.id));

        console.log(`   ✓ Synced: ${newAttendees.length} attendees now in database`);
        totalCreated += newAttendees.length;
      } else {
        console.log(`   ℹ Sync completed`);
      }
    } catch (error) {
      console.error(`   ✗ Error syncing:`, error);
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`\n✅ Cleanup and resync complete!`);
  console.log(`   Total deleted: ${totalDeleted}`);
  console.log(`   Total created: ${totalCreated}`);
  console.log(`   Total updated: ${totalUpdated}`);

  process.exit(0);
}

cleanupAndResync().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
