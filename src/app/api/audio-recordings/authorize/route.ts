import { NextRequest, NextResponse } from "next/server";
import { verifyEmailForAudioRecordings } from "@/lib/audio-recording-auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { z } from "zod";

const authorizeSchema = z.object({
  email: z.string().email().min(1).max(255),
  captchaToken: z.string().min(1),
});

export async function POST(request: NextRequest) {
  // Rate limiting
  const rateLimitResult = await checkRateLimit(request);
  if (!rateLimitResult.success) {
    return rateLimitResponse(rateLimitResult);
  }

  try {
    // Parse and validate request body
    const body = await request.json();
    const validation = authorizeSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 },
      );
    }

    const { email, captchaToken } = validation.data;

    // Verify email and create session
    const result = await verifyEmailForAudioRecordings(email, captchaToken);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 401 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Authorization API error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
