import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  real,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { pgTable } from "@/db/utils";

import { generateId } from "@/lib/id";

// Events table
export const events = pgTable("events", {
  id: varchar("id", { length: 30 })
    .$defaultFn(() => generateId())
    .primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  eventDate: timestamp("event_date").notNull(),
  woocommerceProductId: varchar("woocommerce_product_id", { length: 128 }).unique(),
  mergedIntoEventId: varchar("merged_into_event_id", { length: 30 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`current_timestamp`)
    .$onUpdate(() => new Date()),
});

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;

// Attendees table
export const attendees = pgTable("attendees", {
  id: varchar("id", { length: 30 })
    .$defaultFn(() => generateId())
    .primaryKey(),
  eventId: varchar("event_id", { length: 30 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  firstName: varchar("first_name", { length: 128 }),
  lastName: varchar("last_name", { length: 128 }),
  ticketId: varchar("ticket_id", { length: 128 }), // NEW: Individual WooCommerce ticket ID
  woocommerceOrderId: varchar("woocommerce_order_id", { length: 128 }), // Now stores actual order ID
  woocommerceOrderDate: timestamp("woocommerce_order_date"), // Date when order was placed in WooCommerce
  bookerFirstName: varchar("booker_first_name", { length: 128 }),  // Order purchaser's first name
  bookerLastName: varchar("booker_last_name", { length: 128 }),   // Order purchaser's last name
  bookerEmail: varchar("booker_email", { length: 255 }),           // Order purchaser's email
  locallyModified: boolean("locally_modified").notNull().default(false),
  manuallyAdded: boolean("manually_added").notNull().default(false),
  checkedIn: boolean("checked_in").notNull().default(false),
  checkedInAt: timestamp("checked_in_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`current_timestamp`)
    .$onUpdate(() => new Date()),
}, (table) => ({
  // Unique constraint to prevent duplicate tickets
  uniqueTicketPerEvent: unique("unique_ticket_per_event").on(table.ticketId, table.eventId),
}));

export type Attendee = typeof attendees.$inferSelect;
export type NewAttendee = typeof attendees.$inferInsert;

// Members table
export const members = pgTable("members", {
  id: varchar("id", { length: 30 })
    .$defaultFn(() => generateId())
    .primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  firstName: varchar("first_name", { length: 128 }),
  lastName: varchar("last_name", { length: 128 }),
  isActiveMember: boolean("is_active_member").notNull().default(false),
  totalEventsAttended: real("total_events_attended").notNull().default(0),
  membershipExpiresAt: timestamp("membership_expires_at"),
  lastEventDate: timestamp("last_event_date"),
  manuallyAdded: boolean("manually_added").notNull().default(false),
  manualExpiresAt: timestamp("manual_expires_at"),
  notes: varchar("notes", { length: 1000 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`current_timestamp`)
    .$onUpdate(() => new Date()),
});

export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;

// Email logs table
export const emailLogs = pgTable("email_logs", {
  id: varchar("id", { length: 30 })
    .$defaultFn(() => generateId())
    .primaryKey(),
  memberId: varchar("member_id", { length: 30 }).notNull(),
  emailType: varchar("email_type", {
    length: 50,
    enum: ["membership_expiry_30_days"],
  }).notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  resendId: varchar("resend_id", { length: 255 }),
  status: varchar("status", {
    length: 30,
    enum: ["sent", "failed"],
  })
    .notNull()
    .default("sent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EmailLog = typeof emailLogs.$inferSelect;
export type NewEmailLog = typeof emailLogs.$inferInsert;

// WooCommerce cache table
export const woocommerceCache = pgTable("woocommerce_cache", {
  cacheKey: varchar("cache_key", { length: 255 }).primaryKey(),
  cacheData: jsonb("cache_data").notNull(),
  cachedAt: timestamp("cached_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  eventId: varchar("event_id", { length: 30 }),
});

export type WooCommerceCache = typeof woocommerceCache.$inferSelect;
export type NewWooCommerceCache = typeof woocommerceCache.$inferInsert;

// Loops.so sync log table
export const loopsSyncLog = pgTable("loops_sync_log", {
  id: varchar("id", { length: 30 })
    .$defaultFn(() => generateId())
    .primaryKey(),
  memberId: varchar("member_id", { length: 30 }),
  email: varchar("email", { length: 255 }).notNull(),
  operation: varchar("operation", {
    length: 20,
  }).notNull(),
  status: varchar("status", {
    length: 20,
  }).notNull(),
  errorMessage: varchar("error_message", { length: 1000 }),
  loopsContactId: varchar("loops_contact_id", { length: 128 }),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
});

export type LoopsSyncLog = typeof loopsSyncLog.$inferSelect;
export type NewLoopsSyncLog = typeof loopsSyncLog.$inferInsert;
