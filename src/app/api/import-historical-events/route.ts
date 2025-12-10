import { NextRequest, NextResponse } from "next/server";
import { importHistoricalEvents } from "@/lib/import-historical-events";

/**
 * Import historical events and attendees from WooCommerce
 *
 * Query Parameters:
 * - dryRun: boolean (default: true) - Preview without making changes
 * - monthsBack: number (default: 9) - How far back to import events
 * - markAsCheckedIn: boolean (default: true) - Mark all imported attendees as checked in
 *
 * Example usage:
 * POST /api/import-historical-events?dryRun=true&monthsBack=9&markAsCheckedIn=true
 */
export async function POST(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Parse query parameters with defaults
    const dryRun = searchParams.get("dryRun") !== "false"; // Default: true
    const monthsBack = parseInt(searchParams.get("monthsBack") || "9");
    const markAsCheckedIn = searchParams.get("markAsCheckedIn") === "true"; // Default: false (opt-in)

    console.log("[api] Import request received:", {
      dryRun,
      monthsBack,
      markAsCheckedIn,
    });

    // Validate parameters
    if (monthsBack < 1 || monthsBack > 24) {
      return NextResponse.json(
        {
          success: false,
          error: "monthsBack must be between 1 and 24",
        },
        { status: 400 }
      );
    }

    // Execute import
    const result = await importHistoricalEvents({
      dryRun,
      monthsBack,
      markAsCheckedIn,
    });

    return NextResponse.json(result);

  } catch (error) {
    console.error("[api] Import error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
