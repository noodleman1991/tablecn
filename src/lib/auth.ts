import "server-only";

import { stackServerApp } from "@/stack/server";
import { redirect } from "next/navigation";

/**
 * Server-side auth helper to get the current user
 * Redirects to sign-in if not authenticated
 */
export async function requireAuth() {
  const user = await stackServerApp.getUser();

  if (!user) {
    redirect("/handler/sign-in");
  }

  return user;
}

/**
 * Server-side auth helper to require staff permissions
 * Redirects to sign-in if not authenticated
 * Returns null if user is not staff (caller should handle authorization)
 */
export async function requireStaffAuth() {
  const user = await requireAuth();

  // Check if user has staff role/permission
  // Stack Auth uses permissions - check if user has "staff" permission
  const hasStaffPermission = user.clientMetadata?.role === "staff" ||
                            user.serverMetadata?.role === "staff";

  if (!hasStaffPermission) {
    return null;
  }

  return user;
}

/**
 * Get the current user without redirecting
 * Returns null if not authenticated
 */
export async function getCurrentUser() {
  const user = await stackServerApp.getUser();
  return user;
}
