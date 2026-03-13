import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { requireAuth } from "@/lib/auth";
import { sendLoopsTransactionalEmail } from "@/lib/loops-sync";

export async function POST(request: NextRequest) {
  try {
    await requireAuth();

    const body = await request.json() as { csvContent?: string; filename?: string; recipientEmail?: string };
    const { csvContent, filename, recipientEmail } = body;

    if (!csvContent || !filename) {
      return NextResponse.json(
        { error: "Missing csvContent or filename" },
        { status: 400 }
      );
    }

    if (!env.LOOPS_CSV_EXPORT_TRANSACTIONAL_ID) {
      return NextResponse.json(
        { error: "LOOPS_CSV_EXPORT_TRANSACTIONAL_ID is not configured" },
        { status: 500 }
      );
    }

    // Convert CSV to base64 for attachment
    const csvBuffer = Buffer.from(csvContent, 'utf-8');
    const base64Csv = csvBuffer.toString('base64');

    const result = await sendLoopsTransactionalEmail(
      recipientEmail || "events@kairos.london",
      env.LOOPS_CSV_EXPORT_TRANSACTIONAL_ID,
      {
        date: new Date().toLocaleDateString(),
      },
      [
        {
          filename,
          contentType: "text/csv",
          data: base64Csv,
        },
      ],
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
