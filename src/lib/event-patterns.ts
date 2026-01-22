/**
 * Event Patterns Configuration
 *
 * This file centralizes all event name patterns used for:
 * 1. Determining which events should NEVER be auto-merged
 * 2. Identifying members-only ticket variants
 *
 * Edit these lists to customize event handling behavior.
 */

/**
 * NEVER_MERGE_PATTERNS
 *
 * Recurring event series where each occurrence is distinct.
 * These events should NOT be merged even if they have similar names on the same date.
 *
 * Add new patterns here when you create new recurring event series.
 */
export const NEVER_MERGE_PATTERNS = [
  // ===== Recurring Social/Community Events =====
  /sunday\s*reading\s*room/i, // 26 occurrences - weekly reading sessions
  /friday\s*drinks/i, // 20 occurrences - weekly social
  /open\s*projects?\s*night/i, // 11 occurrences - each session is unique
  /club\s*drinks/i, // Includes "Kairos Club Drinks" - regular social

  // ===== Content-Specific Series (each session has unique content) =====
  /book\s*club/i, // 24 occurrences - different books each time
  /sewing\s*club/i, // 10 occurrences - different skills/projects
  /movie\s*nights?/i, // 5 occurrences - different films
  /lunchtime\s*video/i, // 4 occurrences - different videos

  // ===== Screenings - each is a different film =====
  /screening\s*(of)?\s*["'"]/i, // Matches "Screening of '...'" pattern

  // ===== Workshop Series =====
  /workshop/i, // Different workshop topics

  // ===== Add new recurring event patterns below =====
  // Example: /poetry\s*night/i,
  // Example: /discussion\s*circle/i,
];

/**
 * MEMBERS_ONLY_PATTERNS
 *
 * Product name patterns that indicate a members-only ticket variant.
 * When a WooCommerce product name matches these patterns, tickets from
 * that product are marked as `isMembersOnlyTicket: true`.
 */
export const MEMBERS_ONLY_PATTERNS = [
  /members?\s*only/i, // "member only", "members only"
  /members?\s*booking/i, // "member booking", "members booking"
  /members?\s*link/i, // "member link", "members link"
  /community\s*member/i, // "community member"
  /-\s*members$/i, // ends with "- members"
];

/**
 * Check if an event name matches any NEVER_MERGE pattern
 */
export function shouldNeverMerge(name: string): boolean {
  return NEVER_MERGE_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Check if a product/event name indicates it's a members-only variant
 */
export function isMembersOnlyProduct(name: string): boolean {
  return MEMBERS_ONLY_PATTERNS.some((pattern) => pattern.test(name));
}
