import { sql } from "drizzle-orm";
import { boolean, jsonb, real, timestamp, varchar } from "drizzle-orm/pg-core";
import { pgTable } from "@/db/utils";

import { generateId } from "@/lib/id";

export const tasks = pgTable("tasks", {
  id: varchar("id", { length: 30 })
    .$defaultFn(() => generateId())
    .primaryKey(),
  code: varchar("code", { length: 128 }).notNull().unique(),
  title: varchar("title", { length: 128 }),
  status: varchar("status", {
    length: 30,
    enum: ["todo", "in-progress", "done", "canceled"],
  })
    .notNull()
    .default("todo"),
  label: varchar("label", {
    length: 30,
    enum: ["bug", "feature", "enhancement", "documentation"],
  })
    .notNull()
    .default("bug"),
  priority: varchar("priority", {
    length: 30,
    enum: ["low", "medium", "high"],
  })
    .notNull()
    .default("low"),
  estimatedHours: real("estimated_hours").notNull().default(0),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`current_timestamp`)
    .$onUpdate(() => new Date()),
});

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

// Events table
export const events = pgTable("events", {
  id: varchar("id", { length: 30 })
    .$defaultFn(() => generateId())
    .primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  eventDate: timestamp("event_date").notNull(),
  woocommerceProductId: varchar("woocommerce_product_id", { length: 128 }),
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
  woocommerceOrderId: varchar("woocommerce_order_id", { length: 128 }),
  checkedIn: boolean("checked_in").notNull().default(false),
  checkedInAt: timestamp("checked_in_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`current_timestamp`)
    .$onUpdate(() => new Date()),
});

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
