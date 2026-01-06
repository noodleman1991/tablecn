// Set server environment
process.env.NEXT_RUNTIME = 'nodejs';

import { db } from "@/db";
import { attendees, events } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import fs from "fs";
import { parse } from "csv-parse/sync";

async function validate() {
  console.log("=== VALIDATION REPORT ===\n");

  // Read CSV
  const csv = fs.readFileSync(
    "/Users/amitlockshinski/WebstormProjects/tablecn/public/ticket-export-2026-01-03.csv",
    "utf-8"
  );
  const rows = parse(csv, { columns: true });

  // Get event
  const [event] = await db.select().from(events)
    .where(sql`LOWER(${events.name}) LIKE '%why look at animals%'`);

  if (!event) {
    console.error("❌ Event not found!");
    return;
  }

  // Get DB attendees
  const dbAttendees = await db.select().from(attendees)
    .where(eq(attendees.eventId, event.id));

  console.log(`📄 CSV Export: ${rows.length} tickets`);
  console.log(`💾 Database: ${dbAttendees.length} attendees`);

  if (rows.length === dbAttendees.length) {
    console.log(`✅ MATCH! Counts are equal.\n`);
  } else {
    console.log(`❌ MISMATCH! Difference: ${Math.abs(rows.length - dbAttendees.length)}\n`);
  }

  // Check each CSV ticket exists in DB
  const csvTicketIds = rows.map((r: any) => r["Ticket ID"]);
  const missing = csvTicketIds.filter(
    (ticketId: string) => !dbAttendees.some(a => a.ticketId === ticketId)
  );

  if (missing.length > 0) {
    console.error(`❌ Missing ${missing.length} tickets from CSV:\n   ${missing.join(", ")}\n`);
  } else {
    console.log(`✅ All CSV tickets found in database\n`);
  }

  // Check for multi-ticket orders
  const multiTicketOrders = dbAttendees.reduce((acc, a) => {
    if (!a.woocommerceOrderId) return acc;
    acc[a.woocommerceOrderId] = (acc[a.woocommerceOrderId] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const multi = Object.entries(multiTicketOrders).filter(([_, count]) => count > 1);
  console.log(`📦 Multi-ticket orders: ${multi.length}`);
  multi.forEach(([orderId, count]) => {
    console.log(`   Order ${orderId}: ${count} tickets`);
  });

  // Verify ticketId and woocommerceOrderId are correctly split
  const hasTicketIds = dbAttendees.filter(a => a.ticketId).length;
  const hasOrderIds = dbAttendees.filter(a => a.woocommerceOrderId).length;

  console.log(`\n🔍 Field Verification:`);
  console.log(`   Attendees with ticketId: ${hasTicketIds}/${dbAttendees.length}`);
  console.log(`   Attendees with woocommerceOrderId: ${hasOrderIds}/${dbAttendees.length}`);

  if (hasTicketIds === dbAttendees.length && hasOrderIds === dbAttendees.length) {
    console.log(`   ✅ Both fields properly populated!`);
  }

  process.exit(0);
}

validate().catch(console.error);
