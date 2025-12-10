import { NextResponse } from "next/server";
import { db } from "@/db";
import { attendees, members } from "@/db/schema";
import { recalculateMembershipByEmail } from "@/lib/calculate-membership";

export async function POST() {
  try {
    console.log("[recalc-all] Starting full membership recalculation...");

    // Get all unique emails from attendees
    const allAttendees = await db.select().from(attendees);
    const emailMap = new Map<string, { firstName: string | null; lastName: string | null }>();

    for (const attendee of allAttendees) {
      if (attendee.email && !emailMap.has(attendee.email)) {
        emailMap.set(attendee.email, {
          firstName: attendee.firstName,
          lastName: attendee.lastName,
        });
      }
    }

    console.log(`[recalc-all] Found ${emailMap.size} unique emails`);

    let created = 0;
    let updated = 0;
    let errors = 0;
    const errorList: string[] = [];

    // Process each unique email
    for (const [email, info] of emailMap.entries()) {
      try {
        const result = await recalculateMembershipByEmail(
          email,
          info.firstName,
          info.lastName
        );

        if (result.created) {
          created++;
        } else if (result.updated) {
          updated++;
        }

        if ((created + updated) % 100 === 0) {
          console.log(`[recalc-all] Progress: ${created + updated}/${emailMap.size}`);
        }
      } catch (error) {
        errors++;
        const errorMsg = `${email}: ${error instanceof Error ? error.message : "Unknown error"}`;
        errorList.push(errorMsg);
        console.error(`[recalc-all] Error: ${errorMsg}`);
      }
    }

    console.log("[recalc-all] Recalculation complete!");
    console.log(`[recalc-all] Created: ${created}, Updated: ${updated}, Errors: ${errors}`);

    return NextResponse.json({
      success: true,
      summary: {
        totalProcessed: emailMap.size,
        membersCreated: created,
        membersUpdated: updated,
        errors: errors,
      },
      errorList: errorList.slice(0, 10), // First 10 errors only
    });
  } catch (error) {
    console.error("[recalc-all] Fatal error:", error);
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
