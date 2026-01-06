import "server-only";

import { db } from "@/db";
import { events, attendees, members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { recalculateMembershipByEmail } from "./calculate-membership";
import fs from "fs";
import { parse } from "csv-parse/sync";
import { readFile, utils } from "xlsx";

interface CSVRow {
  "Order Number": string;
  "Order Status": string;
  "Order Date": string;
  "First Name (Billing)": string;
  "Last Name (Billing)": string;
  "Email (Billing)": string;
  "Item Name": string;
  "Quantity (- Refund)": string;
}

interface ImportResult {
  success: boolean;
  summary: {
    rowsProcessed: number;
    attendeesCreated: number;
    attendeesUpdated: number;
    attendeesSkipped: number;
    eventsMatched: number;
    eventsNotMatched: number;
    membersCreated: number;
    membersUpdated: number;
    errors: number;
  };
  unmatchedEvents: string[];
  errors: string[];
}

/**
 * Clean event name by removing pricing tier suffixes
 * Example: "Screening of \"Power Station\" - Standard" -> "Screening of \"Power Station\""
 */
function cleanEventName(itemName: string): string {
  // Remove common pricing tier suffixes
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
    " - Members",
  ];

  let cleaned = itemName;
  for (const tier of pricingTiers) {
    cleaned = cleaned.replace(tier, "");
  }

  return cleaned.trim();
}

/**
 * Read Excel file and convert to CSV row format
 */
function readExcelFile(filePath: string): CSVRow[] {
  console.log(`[excel-import] Reading Excel file: ${filePath}`);

  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const workbook = readFile(filePath);

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error(`No sheets found in Excel file: ${filePath}`);
    }

    const sheetName = workbook.SheetNames[0]; // Use first sheet
    if (!sheetName) {
      throw new Error(`Invalid sheet name in Excel file: ${filePath}`);
    }
    const worksheet = workbook.Sheets[sheetName];

    if (!worksheet) {
      throw new Error(`Sheet "${sheetName}" not found in workbook`);
    }

    // Convert to JSON with header row
    const jsonData = utils.sheet_to_json(worksheet, { raw: false }) as any[];

    console.log(`[excel-import] Found ${jsonData.length} rows in sheet "${sheetName}"`);

    // Map Excel columns to CSVRow format
    return jsonData.map((row) => ({
      "Order Number": row["Order Number"] || "",
      "Order Status": row["Order Status"] || "",
      "Order Date": row["Order Date"] || "",
      "First Name (Billing)": row["First Name (Billing)"] || "",
      "Last Name (Billing)": row["Last Name (Billing)"] || "",
      "Email (Billing)": row["Email (Billing)"] || "",
      "Item Name": row["Item Name"] || "",
      "Quantity (- Refund)": row["Quantity (- Refund)"] || "0",
    }));
  } catch (error) {
    console.error(`[excel-import] Error reading Excel file:`, error);
    throw new Error(`Cannot access file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Find matching event by name (case-insensitive, fuzzy match)
 */
async function findEventByName(itemName: string) {
  const cleanedName = cleanEventName(itemName);

  // Get all events
  const allEvents = await db.select().from(events);

  // Try exact match first
  const exactMatch = allEvents.find(
    (e) => e.name.toLowerCase() === cleanedName.toLowerCase()
  );
  if (exactMatch) return exactMatch;

  // Try fuzzy match (contains)
  const fuzzyMatch = allEvents.find((e) =>
    e.name.toLowerCase().includes(cleanedName.toLowerCase())
  );
  if (fuzzyMatch) return fuzzyMatch;

  // Try reverse (cleanedName contains event name)
  const reverseMatch = allEvents.find((e) =>
    cleanedName.toLowerCase().includes(e.name.toLowerCase())
  );
  if (reverseMatch) return reverseMatch;

  return null;
}

/**
 * Import historical orders from CSV or Excel export
 * Matches events by name and creates attendee records
 */
export async function importFromCSV(filePath: string): Promise<ImportResult> {
  const result: ImportResult = {
    success: true,
    summary: {
      rowsProcessed: 0,
      attendeesCreated: 0,
      attendeesUpdated: 0,
      attendeesSkipped: 0,
      eventsMatched: 0,
      eventsNotMatched: 0,
      membersCreated: 0,
      membersUpdated: 0,
      errors: 0,
    },
    unmatchedEvents: [],
    errors: [],
  };

  try {
    // Detect file type by extension
    const isExcel = filePath.endsWith('.xlsx') || filePath.endsWith('.xls');
    const fileType = isExcel ? 'Excel' : 'CSV';

    console.log(`[import] Reading ${fileType} from ${filePath}...`);

    // Read and parse file based on type
    let rows: CSVRow[];

    if (isExcel) {
      rows = readExcelFile(filePath);
    } else {
      const fileContent = fs.readFileSync(filePath, "utf-8");
      rows = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
      }) as CSVRow[];
    }

    console.log(`[import] Found ${rows.length} rows to process`);

    const matchedEvents = new Set<string>();
    const unmatchedEventNames = new Set<string>();
    const memberEmails = new Set<string>();
    const memberInfo = new Map<string, { firstName: string; lastName: string }>();

    // Process each row
    for (const row of rows) {
      result.summary.rowsProcessed++;

      const orderId = row["Order Number"];
      const orderStatus = row["Order Status"];
      const email = row["Email (Billing)"]?.toLowerCase().trim();
      const firstName = row["First Name (Billing)"]?.trim();
      const lastName = row["Last Name (Billing)"]?.trim();
      const itemName = row["Item Name"]?.trim();
      const quantity = parseInt(row["Quantity (- Refund)"] || "0");

      // Skip if missing required fields
      if (!email || !itemName || quantity <= 0) {
        result.summary.attendeesSkipped++;
        continue;
      }

      // Only process completed or processing orders
      if (!["Completed", "Processing"].includes(orderStatus)) {
        result.summary.attendeesSkipped++;
        continue;
      }

      // Find matching event
      const event = await findEventByName(itemName);

      if (!event) {
        if (!unmatchedEventNames.has(itemName)) {
          unmatchedEventNames.add(itemName);
          result.unmatchedEvents.push(itemName);
          result.summary.eventsNotMatched++;
          console.warn(`[import] No matching event found for: ${itemName}`);
        }
        result.summary.attendeesSkipped++;
        continue;
      }

      matchedEvents.add(event.id);

      // Check if attendee already exists for this order
      // Determine if event is historical (only mark past events as checked-in)
      const eventDate = new Date(event.eventDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Start of today
      eventDate.setHours(0, 0, 0, 0); // Start of event day

      const isHistoricalEvent = eventDate < today;

      const existing = await db
        .select()
        .from(attendees)
        .where(eq(attendees.woocommerceOrderId, orderId))
        .limit(1);

      const existingAttendee = existing[0];
      if (existingAttendee) {
        // Update existing - preserve check-in status
        await db
          .update(attendees)
          .set({
            email,
            firstName,
            lastName,
            // Don't update checkedIn/checkedInAt - preserve manual check-ins
          })
          .where(eq(attendees.id, existingAttendee.id));

        result.summary.attendeesUpdated++;
        console.log(
          `[import] Updated attendee: ${email} for ${event.name} (order ${orderId})`
        );
      } else {
        // Create new attendee
        await db.insert(attendees).values({
          eventId: event.id,
          email,
          firstName,
          lastName,
          ticketId: null, // CSV imports don't have individual ticket IDs
          woocommerceOrderId: orderId,
          checkedIn: isHistoricalEvent, // Only auto-check-in for past events
          checkedInAt: isHistoricalEvent ? eventDate : null, // Use event date, not import date
        });

        result.summary.attendeesCreated++;
        console.log(
          `[import] Created attendee: ${email} for ${event.name} (${isHistoricalEvent ? 'auto-checked-in' : 'pending check-in'}, order ${orderId})`
        );
      }

      // Track member emails for membership recalculation
      if (email) {
        memberEmails.add(email);
        if (!memberInfo.has(email) && firstName && lastName) {
          memberInfo.set(email, { firstName, lastName });
        }
      }
    }

    result.summary.eventsMatched = matchedEvents.size;

    console.log(
      `[import] Recalculating memberships for ${memberEmails.size} members...`
    );

    // Recalculate memberships for all affected members
    for (const email of memberEmails) {
      try {
        const info = memberInfo.get(email);
        const memberResult = await recalculateMembershipByEmail(
          email,
          info?.firstName || null,
          info?.lastName || null,
        );
        if (memberResult.created) {
          result.summary.membersCreated++;
        } else if (memberResult.updated) {
          result.summary.membersUpdated++;
        }
      } catch (error) {
        console.error(
          `[import] Error recalculating membership for ${email}:`,
          error
        );
        result.errors.push(
          `Membership calc failed for ${email}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
        result.summary.errors++;
      }
    }

    console.log("[import] Import complete!");
    console.log(
      `[import] Summary: ${result.summary.attendeesCreated} created, ${result.summary.attendeesUpdated} updated, ${result.summary.attendeesSkipped} skipped`
    );
    console.log(
      `[import] Events: ${result.summary.eventsMatched} matched, ${result.summary.eventsNotMatched} unmatched`
    );
    console.log(
      `[import] Members: ${result.summary.membersCreated} created, ${result.summary.membersUpdated} updated`
    );

    if (result.unmatchedEvents.length > 0) {
      console.warn(
        `[import] Unmatched events: ${result.unmatchedEvents.join(", ")}`
      );
    }

    return result;
  } catch (error) {
    console.error("[import] Import failed:", error);
    result.success = false;
    result.errors.push(
      error instanceof Error ? error.message : "Unknown error"
    );
    return result;
  }
}
