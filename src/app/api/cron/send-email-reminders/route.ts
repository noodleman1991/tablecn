import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { members, emailLogs } from "@/db/schema";
import { env } from "@/env";
import { sendMembershipExpiryReminder } from "@/lib/resend";
import { and, eq, gte, lte, isNotNull } from "drizzle-orm";

/**
 * Cron job to send email reminders for expiring memberships
 * Runs daily at 9 AM and finds members whose membership expires in 30 days
 *
 * Vercel Cron: https://vercel.com/docs/cron-jobs
 * Configured in vercel.json to run daily at 9 AM
 */
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
        emailsSent: 0,
      });
    }

    let successCount = 0;
    let failedCount = 0;
    const results = [];

    // Send email to each member
    for (const member of expiringMembers) {
      // Check if we've already sent a reminder for this expiry period
      const existingLog = await db
        .select()
        .from(emailLogs)
        .where(
          and(
            eq(emailLogs.memberId, member.id),
            eq(emailLogs.emailType, "membership_expiry_30_days"),
            gte(emailLogs.sentAt, thirtyDaysFromNow),
          ),
        )
        .limit(1);

      if (existingLog.length > 0) {
        console.log(
          `[send-email-reminders] Already sent reminder to ${member.email}, skipping`,
        );
        results.push({
          email: member.email,
          status: "skipped",
          reason: "already_sent",
        });
        continue;
      }

      // Send email
      const result = await sendMembershipExpiryReminder(
        member.email,
        member.firstName,
        new Date(member.membershipExpiresAt!),
      );

      if (result.success) {
        // Log successful email
        await db.insert(emailLogs).values({
          memberId: member.id,
          emailType: "membership_expiry_30_days",
          resendId: result.resendId,
          status: "sent",
        });

        successCount++;
        results.push({
          email: member.email,
          status: "sent",
          resendId: result.resendId,
        });
      } else {
        // Log failed email
        await db.insert(emailLogs).values({
          memberId: member.id,
          emailType: "membership_expiry_30_days",
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
      emailsSent: successCount,
      emailsFailed: failedCount,
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
