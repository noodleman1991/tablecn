import { sql } from "drizzle-orm";
import {
  boolean,
  index,
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
export const events = pgTable(
  "events",
  {
    id: varchar("id", { length: 30 })
      .$defaultFn(() => generateId())
      .primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    eventDate: timestamp("event_date").notNull(),
    woocommerceProductId: varchar("woocommerce_product_id", {
      length: 128,
    }).unique(),
    mergedIntoEventId: varchar("merged_into_event_id", { length: 30 }),
    // NEW: Store all merged product IDs to sync orders from all sources
    mergedProductIds: jsonb("merged_product_ids").$type<string[]>().default([]),
    // NEW: Track if this was a members-only product in WooCommerce
    isMembersOnlyProduct: boolean("is_members_only_product").default(false),
    // Whether this event qualifies for community membership calculation.
    // On insert: set from the WooCommerce category "qualifying-for-community-membership"
    // (present → true, absent → false). On update: left untouched by the
    // discover-events cron, so manual DB fixes are sticky.
    isQualifyingEvent: boolean("is_qualifying_event").default(true),
    // Lifecycle status. "cancelled" = soft-deleted because the WC product moved
    // to draft/trash or was hard-deleted (404). Only upcoming events are ever
    // auto-cancelled; past events are immutable.
    status: varchar("status", { length: 20, enum: ["active", "cancelled"] })
      .default("active")
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`current_timestamp`)
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    // Index for event date queries
    idxEventDate: index("idx_events_event_date").on(table.eventDate),
  }),
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;

// Order status enum values
export const ORDER_STATUS_VALUES = [
  "completed",
  "processing",
  "on-hold",
  "pending",
  "cancelled",
  "refunded",
  "failed",
  "deleted", // For UI-initiated soft deletes
] as const;
export type OrderStatus = (typeof ORDER_STATUS_VALUES)[number];

// Attendees table
export const attendees = pgTable(
  "attendees",
  {
    id: varchar("id", { length: 30 })
      .$defaultFn(() => generateId())
      .primaryKey(),
    eventId: varchar("event_id", { length: 30 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    firstName: varchar("first_name", { length: 128 }),
    lastName: varchar("last_name", { length: 128 }),
    ticketId: varchar("ticket_id", { length: 128 }), // Individual WooCommerce ticket ID
    woocommerceOrderId: varchar("woocommerce_order_id", { length: 128 }), // Actual order ID
    woocommerceOrderDate: timestamp("woocommerce_order_date"), // Date when order was placed
    // NEW: Order status from WooCommerce (tracks cancellations/refunds)
    orderStatus: varchar("order_status", { length: 20 })
      .$type<OrderStatus>()
      .default("completed"),
    // NEW: Flag for tickets purchased via members-only link
    isMembersOnlyTicket: boolean("is_members_only_ticket").default(false),
    // NEW: WooCommerce product ID this ticket came from (for tracking after merges)
    sourceProductId: varchar("source_product_id", { length: 128 }),
    // Ticket type from WooCommerce variation (Standard, Under 30, etc.)
    ticketType: varchar("ticket_type", { length: 100 }),
    bookerFirstName: varchar("booker_first_name", { length: 128 }), // Order purchaser's first name
    bookerLastName: varchar("booker_last_name", { length: 128 }), // Order purchaser's last name
    bookerEmail: varchar("booker_email", { length: 255 }), // Order purchaser's email
    // Billing address from WooCommerce order
    billingAddress: varchar("billing_address", { length: 500 }),
    billingCity: varchar("billing_city", { length: 128 }),
    billingPostcode: varchar("billing_postcode", { length: 20 }),
    billingCountry: varchar("billing_country", { length: 10 }),
    billingPhone: varchar("billing_phone", { length: 50 }),
    // How the attendee's name was resolved during sync
    nameResolutionMethod: varchar("name_resolution_method", { length: 30 }),
    locallyModified: boolean("locally_modified").notNull().default(false),
    orderTotal: real("order_total"),
    manuallyAdded: boolean("manually_added").notNull().default(false),
    checkedIn: boolean("checked_in").notNull().default(false),
    checkedInAt: timestamp("checked_in_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`current_timestamp`)
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    // Unique constraint to prevent duplicate tickets
    uniqueTicketPerEvent: unique("unique_ticket_per_event").on(
      table.ticketId,
      table.eventId,
    ),
    // Performance indexes
    idxEventId: index("idx_attendees_event_id").on(table.eventId),
    idxEmail: index("idx_attendees_email").on(table.email),
    idxCheckedIn: index("idx_attendees_checked_in").on(table.checkedIn),
    // Composite index for membership calculation queries
    idxEmailCheckedIn: index("idx_attendees_email_checked_in").on(
      table.email,
      table.checkedIn,
    ),
    // Index for order status filtering
    idxOrderStatus: index("idx_attendees_order_status").on(table.orderStatus),
  }),
);

export type Attendee = typeof attendees.$inferSelect;
export type NewAttendee = typeof attendees.$inferInsert;

// Members table
export const members = pgTable(
  "members",
  {
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
    // Billing address from WooCommerce orders (populated from self-purchase tickets)
    address: varchar("address", { length: 500 }),
    city: varchar("city", { length: 128 }),
    postcode: varchar("postcode", { length: 20 }),
    country: varchar("country", { length: 10 }),
    phone: varchar("phone", { length: 50 }),
    notes: varchar("notes", { length: 1000 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`current_timestamp`)
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    // Index for filtering active members
    idxIsActiveMember: index("idx_members_is_active_member").on(
      table.isActiveMember,
    ),
    // Index for membership expiry queries
    idxMembershipExpiresAt: index("idx_members_membership_expires_at").on(
      table.membershipExpiresAt,
    ),
  }),
);

export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;

// Member email aliases — remembers that an email once belonged to a member
// (past merges), or that an email should be ignored entirely (typos, deleted
// people). Additive memory: the members table is the source of truth for
// current canonical emails; this table remembers everything else so past
// cleanup work is never lost.
export const memberEmailAliases = pgTable(
  "member_email_aliases",
  {
    id: varchar("id", { length: 30 })
      .$defaultFn(() => generateId())
      .primaryKey(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    // Nullable: null means "ignored — not a real member, do not auto-create".
    memberId: varchar("member_id", { length: 30 }),
    status: varchar("status", {
      length: 20,
      enum: ["merged", "ignored", "verified_alt"],
    }).notNull(),
    source: varchar("source", {
      length: 30,
      enum: [
        "manual_merge",
        "backfill_loops",
        "backfill_woocommerce",
        "manual_add",
        "manual_primary_swap",
      ],
    }).notNull(),
    notes: varchar("notes", { length: 500 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`current_timestamp`)
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    idxMemberId: index("idx_member_email_aliases_member_id").on(table.memberId),
    idxStatus: index("idx_member_email_aliases_status").on(table.status),
  }),
);

export type MemberEmailAlias = typeof memberEmailAliases.$inferSelect;
export type NewMemberEmailAlias = typeof memberEmailAliases.$inferInsert;

// Email logs table
export const emailLogs = pgTable(
  "email_logs",
  {
    id: varchar("id", { length: 30 })
      .$defaultFn(() => generateId())
      .primaryKey(),
    memberId: varchar("member_id", { length: 30 }).notNull(),
    emailType: varchar("email_type", {
      length: 50,
      enum: ["membership_expiring_loop"],
    }).notNull(),
    sentAt: timestamp("sent_at").defaultNow().notNull(),
    status: varchar("status", {
      length: 30,
      enum: ["sent", "failed"],
    })
      .notNull()
      .default("sent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    // Index for member email history queries
    idxMemberId: index("idx_email_logs_member_id").on(table.memberId),
  }),
);

export type EmailLog = typeof emailLogs.$inferSelect;
export type NewEmailLog = typeof emailLogs.$inferInsert;

// WooCommerce cache table
export const woocommerceCache = pgTable(
  "woocommerce_cache",
  {
    cacheKey: varchar("cache_key", { length: 255 }).primaryKey(),
    cacheData: jsonb("cache_data").notNull(),
    cachedAt: timestamp("cached_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    eventId: varchar("event_id", { length: 30 }),
  },
  (table) => ({
    // Index for cache cleanup and event-based queries
    idxExpiresAt: index("idx_woo_cache_expires_at").on(table.expiresAt),
    idxEventId: index("idx_woo_cache_event_id").on(table.eventId),
  }),
);

export type WooCommerceCache = typeof woocommerceCache.$inferSelect;
export type NewWooCommerceCache = typeof woocommerceCache.$inferInsert;

// Loops.so sync log table
export const loopsSyncLog = pgTable(
  "loops_sync_log",
  {
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
  },
  (table) => ({
    // Indexes for debugging and analysis
    idxMemberId: index("idx_loops_sync_member_id").on(table.memberId),
    idxEmail: index("idx_loops_sync_email").on(table.email),
  }),
);

export type LoopsSyncLog = typeof loopsSyncLog.$inferSelect;
export type NewLoopsSyncLog = typeof loopsSyncLog.$inferInsert;

// Validation results table
export const validationResults = pgTable("validation_results", {
  id: varchar("id", { length: 30 })
    .$defaultFn(() => generateId())
    .primaryKey(),
  runAt: timestamp("run_at").notNull(),
  mode: varchar("mode", { length: 10 }).notNull(), // 'quick' | 'deep'
  periodFrom: timestamp("period_from").notNull(),
  periodTo: timestamp("period_to").notNull(),
  results: jsonb("results").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ValidationResult = typeof validationResults.$inferSelect;
export type NewValidationResult = typeof validationResults.$inferInsert;

// Resync run history table — persists batch job outcomes for review
export const resyncRuns = pgTable("resync_runs", {
  id: varchar("id", { length: 30 })
    .$defaultFn(() => generateId())
    .primaryKey(),
  jobType: varchar("job_type", { length: 30 }).notNull(), // 'event-resync', 'membership-sync', 'loops-sync'
  status: varchar("status", { length: 20 }).notNull(), // 'completed', 'failed'
  total: integer("total").notNull().default(0),
  processed: integer("processed").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  startOffset: integer("start_offset").notNull().default(0),
  errorMessage: varchar("error_message", { length: 500 }),
  startedAt: timestamp("started_at").notNull(),
  completedAt: timestamp("completed_at").defaultNow().notNull(),
});

export type ResyncRun = typeof resyncRuns.$inferSelect;
export type NewResyncRun = typeof resyncRuns.$inferInsert;

// Product swap map table - tracks which WooCommerce products have swapped first/last name fields
export const productSwapMap = pgTable("product_swap_map", {
  productId: varchar("product_id", { length: 128 }).primaryKey(),
  isSwapped: boolean("is_swapped").notNull().default(false),
  detectionMethod: varchar("detection_method", { length: 20 })
    .$type<"self_purchase" | "cross_reference" | "manual_override">()
    .notNull(),
  confidence: real("confidence").notNull().default(1.0),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`current_timestamp`)
    .$onUpdate(() => new Date()),
});

export type ProductSwapMap = typeof productSwapMap.$inferSelect;
export type NewProductSwapMap = typeof productSwapMap.$inferInsert;
