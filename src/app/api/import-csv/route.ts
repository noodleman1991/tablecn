import { NextResponse } from "next/server";
import { importFromCSV } from "@/lib/import-from-csv";
import path from "path";

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const csvFileName = searchParams.get("file") || "orders-2025-12-04-11-30-06.csv";

    console.log(`[api] Starting CSV import from ${csvFileName}...`);

    // Path to CSV file in project root
    const csvPath = path.join(process.cwd(), csvFileName);

    const result = await importFromCSV(csvPath);

    return NextResponse.json(result);
  } catch (error) {
    console.error("[api] CSV import failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export const maxDuration = 300; // 5 minutes
