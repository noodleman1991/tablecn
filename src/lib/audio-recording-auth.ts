import "server-only";

import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { env } from "@/env";
import {
  createAudioRecordingSession,
  getAudioRecordingSession,
  isSessionValid,
} from "./audio-recording-session";
import type { AuthorizationResult } from "@/types/audio-recording-auth";

export async function verifyEmailForAudioRecordings(
  email: string,
  captchaToken: string,
): Promise<AuthorizationResult> {
  try {
    // 1. Verify hCaptcha token server-side (Dec 2025 endpoint)
    const captchaVerification = await fetch(
      "https://api.hcaptcha.com/siteverify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          secret: env.HCAPTCHA_SECRET_KEY, // Account-level Secret (ES_...)
          response: captchaToken,
        }),
      },
    );

    const captchaResult = await captchaVerification.json();

    if (!captchaResult.success) {
      return {
        success: false,
        error: "Captcha verification failed. Please try again.",
      };
    }

    // 2. Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // 3. Query database for member
    const memberResults = await db
      .select()
      .from(members)
      .where(eq(members.email, normalizedEmail))
      .limit(1);

    // 4. Validate membership status with timing-safe delay
    if (memberResults.length === 0 || !memberResults[0]?.isActiveMember) {
      // Introduce artificial delay to prevent timing attacks (200-300ms)
      await new Promise((resolve) =>
        setTimeout(resolve, 200 + Math.random() * 100),
      );
      return {
        success: false,
        error:
          "We couldn't verify your access. Please check your email or contact support.",
      };
    }

    // 5. Create session
    await createAudioRecordingSession(normalizedEmail);

    return { success: true };
  } catch (error) {
    console.error("Audio recording authorization error:", error);
    return {
      success: false,
      error: "An error occurred. Please try again.",
    };
  }
}

export async function requireAudioRecordingAuth(): Promise<string | null> {
  const valid = await isSessionValid();
  if (!valid) {
    return null;
  }

  const session = await getAudioRecordingSession();
  return session.email || null;
}
