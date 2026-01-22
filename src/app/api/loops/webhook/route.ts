import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { removeMemberFromLoops } from "@/lib/loops-sync";
import { format } from "date-fns";

/**
 * Loops.so Webhook Handler
 *
 * Receives webhook events from Loops when users unsubscribe.
 * When a community member unsubscribes from Loops:
 * 1. Find them by email in our members table
 * 2. Set isActiveMember to false
 * 3. Add a note with timestamp
 * 4. Remove from Loops Active Members list
 *
 * To configure in Loops:
 * 1. Go to Loops Dashboard > Settings > Webhooks
 * 2. Add webhook URL: https://your-domain.com/api/loops/webhook
 * 3. Select events: contact.unsubscribed
 */

// Loops webhook payload types
interface LoopsWebhookEvent {
  type: string;
  created: string;
  data: {
    email: string;
    userId?: string;
    mailingLists?: Record<string, boolean>;
    [key: string]: unknown;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as LoopsWebhookEvent;

    console.log(`[Loops Webhook] Received event: ${body.type}`);

    // Handle contact.unsubscribed event
    if (body.type === "contact.unsubscribed" || body.type === "contact.deleted") {
      const email = body.data?.email?.toLowerCase();

      if (!email) {
        console.warn("[Loops Webhook] No email in webhook payload");
        return NextResponse.json({ success: false, message: "No email provided" }, { status: 400 });
      }

      console.log(`[Loops Webhook] Processing unsubscribe for: ${email}`);

      // Find the member by email
      const existingMember = await db
        .select()
        .from(members)
        .where(eq(members.email, email))
        .limit(1);

      const member = existingMember[0];
      if (!member) {
        console.log(`[Loops Webhook] Member not found in database: ${email}`);
        return NextResponse.json({
          success: true,
          message: "Email not found in community members"
        });
      }
      const now = new Date();
      const timestamp = format(now, "MMMM d, yyyy 'at' h:mm a");

      // Build the note
      const unsubscribeNote = `Member unsubscribed from Loops on ${timestamp}`;
      const existingNotes = member.notes || "";
      const newNotes = existingNotes
        ? `${existingNotes}\n\n${unsubscribeNote}`
        : unsubscribeNote;

      // Update the member: deactivate and add note
      await db
        .update(members)
        .set({
          isActiveMember: false,
          notes: newNotes,
        })
        .where(eq(members.id, member.id));

      console.log(`[Loops Webhook] Deactivated member: ${email}`);

      // Also ensure they're removed from Loops Active Members list
      // (they may have unsubscribed globally but we want to be sure)
      await removeMemberFromLoops(email, member.id);

      return NextResponse.json({
        success: true,
        message: "Member deactivated successfully",
        email,
        wasActive: member.isActiveMember,
      });
    }

    // Handle other events (just acknowledge)
    console.log(`[Loops Webhook] Ignoring event type: ${body.type}`);
    return NextResponse.json({ success: true, message: "Event acknowledged" });

  } catch (error) {
    console.error("[Loops Webhook] Error processing webhook:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}

// Verify webhook endpoint is accessible
export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "Loops webhook endpoint is active",
    supportedEvents: ["contact.unsubscribed", "contact.deleted"],
  });
}
