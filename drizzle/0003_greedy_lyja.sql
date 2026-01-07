ALTER TABLE "shadcn_woocommerce_cache" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "shadcn_woocommerce_cache" CASCADE;--> statement-breakpoint
ALTER TABLE "shadcn_attendees" RENAME TO "tablecn_attendees";--> statement-breakpoint
ALTER TABLE "shadcn_email_logs" RENAME TO "tablecn_email_logs";--> statement-breakpoint
ALTER TABLE "shadcn_events" RENAME TO "tablecn_events";--> statement-breakpoint
ALTER TABLE "shadcn_members" RENAME TO "tablecn_members";--> statement-breakpoint
ALTER TABLE "shadcn_tasks" RENAME TO "tablecn_woocommerce_cache";--> statement-breakpoint
ALTER TABLE "tablecn_members" DROP CONSTRAINT "shadcn_members_email_unique";--> statement-breakpoint
ALTER TABLE "tablecn_woocommerce_cache" DROP CONSTRAINT "shadcn_tasks_code_unique";--> statement-breakpoint
ALTER TABLE "tablecn_attendees" ADD COLUMN "ticket_id" varchar(128);--> statement-breakpoint
ALTER TABLE "tablecn_attendees" ADD COLUMN "booker_first_name" varchar(128);--> statement-breakpoint
ALTER TABLE "tablecn_attendees" ADD COLUMN "booker_last_name" varchar(128);--> statement-breakpoint
ALTER TABLE "tablecn_attendees" ADD COLUMN "booker_email" varchar(255);--> statement-breakpoint
ALTER TABLE "tablecn_attendees" ADD COLUMN "locally_modified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tablecn_attendees" ADD COLUMN "manually_added" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tablecn_events" ADD COLUMN "merged_into_event_id" varchar(30);--> statement-breakpoint
ALTER TABLE "tablecn_woocommerce_cache" ADD COLUMN "cache_key" varchar(255) PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "tablecn_woocommerce_cache" ADD COLUMN "cache_data" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tablecn_woocommerce_cache" ADD COLUMN "cached_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "tablecn_woocommerce_cache" ADD COLUMN "expires_at" timestamp NOT NULL;--> statement-breakpoint
ALTER TABLE "tablecn_woocommerce_cache" ADD COLUMN "event_id" varchar(30);--> statement-breakpoint
ALTER TABLE "tablecn_woocommerce_cache" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "tablecn_woocommerce_cache" DROP COLUMN "code";--> statement-breakpoint
ALTER TABLE "tablecn_woocommerce_cache" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "tablecn_woocommerce_cache" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "tablecn_woocommerce_cache" DROP COLUMN "label";--> statement-breakpoint
ALTER TABLE "tablecn_woocommerce_cache" DROP COLUMN "priority";--> statement-breakpoint
ALTER TABLE "tablecn_woocommerce_cache" DROP COLUMN "estimated_hours";--> statement-breakpoint
ALTER TABLE "tablecn_woocommerce_cache" DROP COLUMN "archived";--> statement-breakpoint
ALTER TABLE "tablecn_woocommerce_cache" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "tablecn_woocommerce_cache" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "tablecn_attendees" ADD CONSTRAINT "unique_ticket_per_event" UNIQUE("ticket_id","event_id");--> statement-breakpoint
ALTER TABLE "tablecn_events" ADD CONSTRAINT "tablecn_events_woocommerce_product_id_unique" UNIQUE("woocommerce_product_id");--> statement-breakpoint
ALTER TABLE "tablecn_members" ADD CONSTRAINT "tablecn_members_email_unique" UNIQUE("email");