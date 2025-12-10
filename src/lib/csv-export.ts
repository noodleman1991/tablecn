/**
 * CSV export utilities for event door lists and community members
 */

import type { Attendee, Member, Event } from "@/db/schema";
import { format } from "date-fns";

/**
 * Convert data to CSV format
 */
function arrayToCSV(data: string[][]): string {
  return data
    .map((row) =>
      row
        .map((cell) => {
          // Escape quotes and wrap in quotes if contains comma, quote, or newline
          const cellStr = String(cell ?? "");
          if (cellStr.includes(",") || cellStr.includes('"') || cellStr.includes("\n")) {
            return `"${cellStr.replace(/"/g, '""')}"`;
          }
          return cellStr;
        })
        .join(","),
    )
    .join("\n");
}

/**
 * Export event door list to CSV
 */
export function exportDoorListToCSV(
  event: Event,
  attendees: Attendee[],
): string {
  const headers = [
    "Email",
    "First Name",
    "Last Name",
    "WooCommerce Order ID",
    "Checked In",
    "Checked In At",
  ];

  const rows = attendees.map((attendee) => [
    attendee.email,
    attendee.firstName || "",
    attendee.lastName || "",
    attendee.woocommerceOrderId || "",
    attendee.checkedIn ? "Yes" : "No",
    attendee.checkedInAt
      ? format(new Date(attendee.checkedInAt), "PPpp")
      : "",
  ]);

  return arrayToCSV([headers, ...rows]);
}

/**
 * Export community members to CSV
 */
export function exportMembersToCSV(members: Member[]): string {
  const headers = [
    "Email",
    "First Name",
    "Last Name",
    "Active Member",
    "Total Events Attended",
    "Membership Expires At",
    "Last Event Date",
  ];

  const rows = members.map((member) => [
    member.email,
    member.firstName || "",
    member.lastName || "",
    member.isActiveMember ? "Yes" : "No",
    String(member.totalEventsAttended),
    member.membershipExpiresAt
      ? format(new Date(member.membershipExpiresAt), "PPP")
      : "",
    member.lastEventDate
      ? format(new Date(member.lastEventDate), "PPP")
      : "",
  ]);

  return arrayToCSV([headers, ...rows]);
}

/**
 * Generate filename for door list export
 */
export function generateDoorListFilename(event: Event): string {
  const eventName = event.name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  const eventDate = format(new Date(event.eventDate), "yyyy-MM-dd");
  return `door_list_${eventName}_${eventDate}.csv`;
}

/**
 * Generate filename for members export
 */
export function generateMembersFilename(): string {
  const today = format(new Date(), "yyyy-MM-dd");
  return `community_members_${today}.csv`;
}

/**
 * Download CSV file on client-side
 */
export function downloadCSV(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");

  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

/**
 * Open mailto with instructions to attach CSV
 */
export function openMailtoWithCSVInstructions(
  subject: string,
  filename: string,
): void {
  const body = encodeURIComponent(
    `Hi,\n\nPlease find the attached CSV file: ${filename}\n\nBest regards`,
  );
  const mailtoLink = `mailto:?subject=${encodeURIComponent(subject)}&body=${body}`;

  window.location.href = mailtoLink;
}

/**
 * Export door list and open mailto (client-side)
 */
export function exportDoorListWithEmail(
  event: Event,
  attendees: Attendee[],
): void {
  const csvContent = exportDoorListToCSV(event, attendees);
  const filename = generateDoorListFilename(event);

  // Download CSV
  downloadCSV(csvContent, filename);

  // Open mailto
  const subject = `Door List - ${event.name}`;
  openMailtoWithCSVInstructions(subject, filename);
}

/**
 * Export members and open mailto (client-side)
 * @deprecated Use emailCSVViaServer for actual email with attachment
 */
export function exportMembersWithEmail(members: Member[]): void {
  const csvContent = exportMembersToCSV(members);
  const filename = generateMembersFilename();

  // Download CSV
  downloadCSV(csvContent, filename);

  // Open mailto
  const subject = "Community Members List";
  openMailtoWithCSVInstructions(subject, filename);
}

/**
 * Email CSV via server action with actual attachment
 */
export async function emailCSVViaServer(
  csvContent: string,
  filename: string,
  recipientEmail?: string
): Promise<{ success: boolean; emailId?: string }> {
  const response = await fetch("/api/email/send-csv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csvContent, filename, recipientEmail }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to send email");
  }

  return await response.json();
}
