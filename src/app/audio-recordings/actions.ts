"use server";

import { destroyAudioRecordingSession } from "@/lib/audio-recording-session";

export async function logoutAction() {
  await destroyAudioRecordingSession();
}
