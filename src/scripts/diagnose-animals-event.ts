// Set server environment
process.env.NEXT_RUNTIME = 'nodejs';

import { db } from "@/db";
import { attendees, events } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import fs from "fs";
import { parse } from "csv-parse/sync";
import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import { env } from "@/env";

// Create WooCommerce client directly - handle both default and named exports
const WooCommerceAPI = (WooCommerceRestApi as any).default || WooCommerceRestApi;
const woocommerce = new WooCommerceAPI({
  url: env.WOOCOMMERCE_URL,
  consumerKey: env.WOOCOMMERCE_CONSUMER_KEY,
  consumerSecret: env.WOOCOMMERCE_CONSUMER_SECRET,
  version: "wc/v3",
  timeout: 30000,
});

async function diagnose() {
  console.log("=== DIAGNOSTIC REPORT ===\n");

  // 1. Read CSV (source of truth)
  const csv = fs.readFileSync(
    "/Users/amitlockshinski/WebstormProjects/tablecn/public/ticket-export-2026-01-03.csv",
    "utf-8"
  );
  const csvRows = parse(csv, { columns: true });
  console.log(`📄 CSV Export: ${csvRows.length} tickets`);
  console.log(`   Ticket IDs: ${csvRows.slice(0, 5).map((r: any) => r["Ticket ID"]).join(", ")}...`);

  // 2. Get event from database
  const [event] = await db.select().from(events)
    .where(sql`LOWER(${events.name}) LIKE '%why look at animals%'`);

  if (!event) {
    console.error("❌ Event not found in database!");
    return;
  }

  console.log(`\n🎫 Event: ${event.name}`);
  console.log(`   ID: ${event.id}`);
  console.log(`   Event Date in DB: ${event.eventDate}`);
  console.log(`   WooCommerce Product ID: ${event.woocommerceProductId}`);

  // Check date filtering logic
  const eventDate = new Date(event.eventDate);
  const after = new Date(eventDate);
  after.setDate(after.getDate() - 60);
  const before = new Date(eventDate);
  before.setDate(before.getDate() + 7);

  console.log(`\n📅 Date Filter Range (if used by sync):`);
  console.log(`   After: ${after.toISOString()} (60 days before event)`);
  console.log(`   Before: ${before.toISOString()} (7 days after event)`);

  // Check CSV purchase dates
  const csvDates = csvRows.map((r: any) => new Date(r["Purchase date"]));
  const earliestPurchase = new Date(Math.min(...csvDates.map(d => d.getTime())));
  const latestPurchase = new Date(Math.max(...csvDates.map(d => d.getTime())));

  console.log(`\n📅 CSV Purchase Dates:`);
  console.log(`   Earliest: ${earliestPurchase.toISOString()}`);
  console.log(`   Latest: ${latestPurchase.toISOString()}`);

  if (earliestPurchase < after) {
    console.log(`   ⚠️  WARNING: Earliest purchase (${earliestPurchase.toISOString()}) is BEFORE date filter!`);
    console.log(`   This explains why some orders are missing!`);
  }

  // 3. Get database attendees
  const dbAttendees = await db.select().from(attendees)
    .where(eq(attendees.eventId, event.id));

  console.log(`\n💾 Database: ${dbAttendees.length} attendees`);
  console.log(`   Discrepancy: ${dbAttendees.length - csvRows.length} (${dbAttendees.length > csvRows.length ? 'EXTRA' : 'MISSING'})`);

  // 4. Fetch ACTUAL WooCommerce data WITHOUT date filtering
  console.log(`\n🔄 Fetching from WooCommerce API (ALL orders, no date filter)...`);

  // Fetch ALL recent orders
  let allOrders: any[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= 10) {
    const wcResponse = await woocommerce.get("orders", {
      per_page: 100,
      page,
      status: "completed,processing,on-hold,pending",
      orderby: "id",
      order: "desc",
    });
    allOrders = allOrders.concat(wcResponse.data);
    hasMore = wcResponse.data.length === 100;
    page++;
  }

  console.log(`   Total orders fetched: ${allOrders.length}`);

  const wcOrders = allOrders.filter((order: any) => {
    return order.line_items?.some((item: any) =>
      item.product_id?.toString() === event.woocommerceProductId
    );
  });

  console.log(`   Orders for this product: ${wcOrders.length}`);

  // 5. Extract tickets from WooCommerce orders
  let wcTicketCount = 0;
  let wcTicketsWithData = 0;
  let wcTicketsWithoutData = 0;

  for (const order of wcOrders) {
    const lineItems = order.line_items?.filter((item: any) =>
      item.product_id?.toString() === event.woocommerceProductId
    ) || [];

    for (const lineItem of lineItems) {
      const ticketDataMeta = lineItem.meta_data?.find((m: any) => m.key === '_ticket_data');

      if (ticketDataMeta && Array.isArray(ticketDataMeta.value)) {
        wcTicketCount += ticketDataMeta.value.length;
        wcTicketsWithData += ticketDataMeta.value.length;
      } else {
        // NO TICKET DATA - fallback would trigger here
        const quantity = parseInt(lineItem.quantity) || 1;
        wcTicketCount += quantity;
        wcTicketsWithoutData += quantity;
        console.warn(`   ⚠️  Order ${order.id}: Missing _ticket_data, quantity=${quantity}`);
      }
    }
  }

  console.log(`\n🎟️  WooCommerce Tickets:`);
  console.log(`   Total: ${wcTicketCount}`);
  console.log(`   With _ticket_data: ${wcTicketsWithData}`);
  console.log(`   WITHOUT _ticket_data (fallback): ${wcTicketsWithoutData}`);

  // 6. Compare ticket IDs
  const csvTicketIds = new Set(csvRows.map((r: any) => r["Ticket ID"]));
  const dbTicketIds = new Set(dbAttendees.map(a => a.woocommerceOrderId).filter(Boolean));

  const inCsvNotInDb = [...csvTicketIds].filter(id => !dbTicketIds.has(id));
  const inDbNotInCsv = [...dbTicketIds].filter(id => !csvTicketIds.has(id) && !id.includes('fallback'));

  console.log(`\n🔍 Ticket ID Comparison:`);
  console.log(`   In CSV but NOT in DB: ${inCsvNotInDb.length}`);
  if (inCsvNotInDb.length > 0) {
    console.log(`      ${inCsvNotInDb.slice(0, 10).join(", ")}`);
  }

  console.log(`   In DB but NOT in CSV: ${inDbNotInCsv.length}`);
  if (inDbNotInCsv.length > 0) {
    console.log(`      ${inDbNotInCsv.slice(0, 10).join(", ")}`);
  }

  // 7. Check for fallback tickets in database
  const fallbackTickets = dbAttendees.filter(a =>
    a.woocommerceOrderId?.includes('fallback')
  );

  console.log(`\n🚨 Fallback Tickets in DB: ${fallbackTickets.length}`);
  if (fallbackTickets.length > 0) {
    console.log("   These are FAKE attendees created when _ticket_data was missing!");
    fallbackTickets.forEach(a => {
      console.log(`   - ${a.firstName} ${a.lastName} (${a.woocommerceOrderId})`);
    });
  }

  // 8. Debug: Check what orders we're getting
  console.log(`\n📦 Order IDs from WooCommerce API:`);
  wcOrders.slice(0, 10).forEach((o: any) => {
    console.log(`   Order #${o.id}: ${o.line_items?.length} line items, status: ${o.status}`);
  });

  console.log(`\n📦 Order IDs from CSV:`);
  const csvOrderIds = [...new Set(csvRows.map((r: any) => r["Order ID"]))];
  console.log(`   ${csvOrderIds.length} unique orders: ${csvOrderIds.slice(0, 10).join(", ")}...`);

  // Check if CSV orders match WooCommerce orders
  const wcOrderIds = new Set(wcOrders.map((o: any) => o.id.toString()));
  const csvOrdersNotInWC = csvOrderIds.filter(id => !wcOrderIds.has(id));
  console.log(`\n❗ CSV orders NOT found in WooCommerce API: ${csvOrdersNotInWC.length}`);
  if (csvOrdersNotInWC.length > 0) {
    console.log(`   ${csvOrdersNotInWC.slice(0, 10).join(", ")}...`);
  }

  // 9. Summary
  console.log(`\n=== SUMMARY ===`);
  console.log(`CSV (truth): ${csvRows.length} tickets`);
  console.log(`WooCommerce API: ${wcTicketCount} tickets (${wcTicketsWithoutData} missing _ticket_data)`);
  console.log(`Database: ${dbAttendees.length} attendees`);

  if (wcTicketsWithoutData > 0) {
    console.log(`\n🎯 ROOT CAUSE: ${wcTicketsWithoutData} tickets are missing _ticket_data in WooCommerce API`);
    console.log(`   The fallback logic is creating FAKE attendees for these!`);
  }

  if (csvRows.length === wcTicketsWithData) {
    console.log(`\n✅ CSV count matches WooCommerce tickets WITH proper data`);
    console.log(`   This confirms: WooCommerce API is NOT returning _ticket_data for some tickets`);
  }

  if (csvOrdersNotInWC.length > 0) {
    console.log(`\n🎯 REAL ROOT CAUSE: WooCommerce API is not returning ALL orders for this product!`);
    console.log(`   ${csvOrdersNotInWC.length} orders from CSV are missing from the API response`);
    console.log(`   This could be due to:`);
    console.log(`   - Date filtering too narrow`);
    console.log(`   - Pagination issues (only getting first 100)`);
    console.log(`   - Order status filtering (excluding some statuses)`);
    console.log(`   - Wrong product ID match logic`);
  }

  process.exit(0);
}

diagnose().catch(console.error);
