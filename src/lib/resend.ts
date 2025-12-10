import "server-only";

import { Resend } from "resend";
import { env } from "@/env";

/**
 * Resend API client
 * Docs: https://resend.com/docs
 */
export const resend = new Resend(env.RESEND_API_KEY);

/**
 * Send membership expiry reminder email
 */
export async function sendMembershipExpiryReminder(
  email: string,
  firstName: string | null,
  expiryDate: Date,
) {
  const name = firstName || "Member";
  const formattedDate = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
  }).format(expiryDate);

  try {
    const result = await resend.emails.send({
      from: "Kairos Community <noreply@kairos.london>",
      to: email,
      subject: "Your Kairos Membership Expires Soon",
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Membership Expiry Reminder</title>
</head>
<body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f8f9fa; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
    <h1 style="color: #1a1a1a; margin: 0 0 20px 0; font-size: 24px;">Membership Expiry Reminder</h1>

    <p style="margin: 0 0 15px 0; font-size: 16px;">Hi ${name},</p>

    <p style="margin: 0 0 15px 0; font-size: 16px;">
      We wanted to let you know that your Kairos Community membership will expire on <strong>${formattedDate}</strong>.
    </p>

    <p style="margin: 0 0 15px 0; font-size: 16px;">
      To maintain your active membership status, please attend at least <strong>3 events within a 9-month period</strong>.
    </p>

    <p style="margin: 0 0 15px 0; font-size: 16px;">
      We'd love to see you at our upcoming events! Check out our events calendar and book your tickets.
    </p>

    <div style="margin: 30px 0;">
      <a href="https://kairos.london" style="display: inline-block; background-color: #0066cc; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
        View Upcoming Events
      </a>
    </div>

    <p style="margin: 20px 0 0 0; font-size: 14px; color: #666;">
      If you have any questions, please don't hesitate to reach out.
    </p>
  </div>

  <div style="text-align: center; color: #999; font-size: 12px; margin-top: 20px;">
    <p>Kairos Community | London</p>
    <p>You're receiving this because you're a Kairos Community member.</p>
  </div>
</body>
</html>
      `,
    });

    console.log(
      `[resend] Sent membership expiry reminder to ${email}, Resend ID: ${result.data?.id}`,
    );

    return {
      success: true,
      resendId: result.data?.id,
    };
  } catch (error) {
    console.error(`[resend] Failed to send email to ${email}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
