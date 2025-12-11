import "server-only";

import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { env } from "@/env";
import type { AudioRecordingSessionData } from "@/types/audio-recording-auth";

export const sessionOptions: SessionOptions = {
  password: env.AUDIO_RECORDING_SESSION_SECRET,
  cookieName: "audio_recording_session",
  cookieOptions: {
    secure: env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 8 * 60 * 60, // 8 hours in seconds
    path: "/audio-recordings",
  },
};

export async function getAudioRecordingSession() {
  return getIronSession<AudioRecordingSessionData>(
    await cookies(),
    sessionOptions,
  );
}

export async function createAudioRecordingSession(email: string) {
  const session = await getAudioRecordingSession();
  const now = Date.now();

  session.email = email;
  session.authorizedAt = now;
  session.expiresAt = now + 8 * 60 * 60 * 1000; // 8 hours in milliseconds

  await session.save();
}

export async function destroyAudioRecordingSession() {
  const session = await getAudioRecordingSession();
  session.destroy();
}

export async function isSessionValid(): Promise<boolean> {
  const session = await getAudioRecordingSession();

  if (!session.email || !session.expiresAt) {
    return false;
  }

  return Date.now() < session.expiresAt;
}
