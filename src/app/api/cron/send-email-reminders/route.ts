import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { members, emailLogs } from "@/db/schema";
import { env } from "@/env";
import { sendLoopsEvent } from "@/lib/loops-sync";
import { and, eq, gte, lte, isNotNull } from "drizzle-orm";

/**
 * Cron job to send Loops events for expiring memberships
 * Runs daily at 9 AM and finds members whose membership expires in 30 days
 * Triggers the "membership_expiring" Loop which handles the full reminder sequence
 * (30-day, 7-day, and expired notifications)
 *
 * Vercel Cron: https://vercel.com/docs/cron-jobs
 * Configured in vercel.json to run daily at 9 AM
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[send-email-reminders] Starting email reminder job...");

    // Calculate date range: 30 days from now (with 1-day buffer)
    const now = new Date();
    const thirtyDaysFromNow = new Date(now);
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const thirtyOneDaysFromNow = new Date(now);
    thirtyOneDaysFromNow.setDate(thirtyOneDaysFromNow.getDate() + 31);

    // Set times to start/end of day
    thirtyDaysFromNow.setHours(0, 0, 0, 0);
    thirtyOneDaysFromNow.setHours(23, 59, 59, 999);

    console.log(
      `[send-email-reminders] Looking for memberships expiring between ${thirtyDaysFromNow.toISOString()} and ${thirtyOneDaysFromNow.toISOString()}`,
    );

    // Find active members whose membership expires in 30 days
    const expiringMembers = await db
      .select()
      .from(members)
      .where(
        and(
          eq(members.isActiveMember, true),
          isNotNull(members.membershipExpiresAt),
          gte(members.membershipExpiresAt, thirtyDaysFromNow),
          lte(members.membershipExpiresAt, thirtyOneDaysFromNow),
        ),
      );

    console.log(
      `[send-email-reminders] Found ${expiringMembers.length} members with expiring memberships`,
    );

    if (expiringMembers.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No members with expiring memberships",
        eventsSent: 0,
      });
    }

    let successCount = 0;
    let failedCount = 0;
    const results = [];

    // Send Loops event for each member
    for (const member of expiringMembers) {
      // Check if we've already triggered the Loop for this expiry period
      const existingLog = await db
        .select()
        .from(emailLogs)
        .where(
          and(
            eq(emailLogs.memberId, member.id),
            eq(emailLogs.emailType, "membership_expiring_loop"),
            gte(emailLogs.sentAt, thirtyDaysFromNow),
          ),
        )
        .limit(1);

      if (existingLog.length > 0) {
        console.log(
          `[send-email-reminders] Already triggered Loop for ${member.email}, skipping`,
        );
        results.push({
          email: member.email,
          status: "skipped",
          reason: "already_sent",
        });
        continue;
      }

      // Send Loops event to trigger the membership_expiring Loop
      const result = await sendLoopsEvent(
        member.email,
        "membership_expiring",
        {
          daysUntilExpiry: 30,
          expiryDate: member.membershipExpiresAt!.toISOString(),
        },
      );

      if (result.success) {
        // Log successful event
        await db.insert(emailLogs).values({
          memberId: member.id,
          emailType: "membership_expiring_loop",
          status: "sent",
        });

        successCount++;
        results.push({
          email: member.email,
          status: "sent",
        });
      } else {
        // Log failed event
        await db.insert(emailLogs).values({
          memberId: member.id,
          emailType: "membership_expiring_loop",
          status: "failed",
        });

        failedCount++;
        results.push({
          email: member.email,
          status: "failed",
          error: result.error,
        });
      }
    }

    console.log(
      `[send-email-reminders] Completed: ${successCount} sent, ${failedCount} failed`,
    );

    return NextResponse.json({
      success: true,
      totalMembers: expiringMembers.length,
      eventsSent: successCount,
      eventsFailed: failedCount,
      results,
    });
  } catch (error) {
    console.error("[send-email-reminders] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to send email reminders",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
