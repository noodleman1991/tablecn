import { NextResponse } from "next/server";
import { db } from "@/db";
import { events } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const allEvents = await db
      .select()
      .from(events)
      .orderBy(desc(events.eventDate))
      .limit(100);

    return NextResponse.json({
      success: true,
      count: allEvents.length,
      events: allEvents.map((e) => ({
        id: e.id,
        name: e.name,
        eventDate: e.eventDate,
        woocommerceProductId: e.woocommerceProductId,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
