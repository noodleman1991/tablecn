import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { env } from "@/env";
import { requireAuth } from "@/lib/auth";

const resend = new Resend(env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  try {
    await requireAuth();

    const body = await request.json();
    const { csvContent, filename, recipientEmail } = body;

    if (!csvContent || !filename) {
      return NextResponse.json(
        { error: "Missing csvContent or filename" },
        { status: 400 }
      );
    }

    // Convert CSV to base64 for attachment
    const csvBuffer = Buffer.from(csvContent, 'utf-8');
    const base64Csv = csvBuffer.toString('base64');

    const { data, error } = await resend.emails.send({
      from: "Events <noreply@kairos.london>",
      to: recipientEmail || "events@kairos.london",
      subject: `Community Members List - ${new Date().toLocaleDateString()}`,
      html: `
        <h2>Community Members List</h2>
        <p>Please find the community members CSV file attached.</p>
        <p>Generated on: ${new Date().toLocaleString()}</p>
      `,
      attachments: [
        {
          filename,
          content: base64Csv,
          contentType: 'text/csv',
        },
      ],
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, emailId: data?.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
