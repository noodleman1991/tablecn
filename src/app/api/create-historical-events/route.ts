import { createHistoricalEventsFromCSV } from "@/lib/import-historical-events";
import { NextResponse } from "next/server";

/**
 * API endpoint to create historical event records from CSV data
 *
 * This endpoint reads the orders CSV file and creates event records for all unique
 * events found in the historical data. This is necessary before importing historical
 * attendees, as the import system matches orders to existing events.
 *
 * Usage:
 *   POST /api/create-historical-events
 *
 * Optional query params:
 *   ?file=orders-2025-12-05-21-21-50.csv
 *
 * Returns:
 *   {
 *     success: boolean
 *     totalUnique: number
 *     eventsCreated: number
 *     eventsSkipped: number
 *     errors: string[]
 *     eventList?: Array<{ name: string, date: string, created: boolean }>
 *   }
 */
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const csvFile = searchParams.get("file") || "orders-2025-12-05-21-21-50.csv";

    console.log(`[api/create-historical-events] Creating historical events from ${csvFile}...`);

    const result = await createHistoricalEventsFromCSV(csvFile);

    if (!result.success) {
      return NextResponse.json(
        {
          error: "Failed to create historical events",
          details: result.errors,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/create-historical-events] Error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
