ALTER TABLE "tablecn_attendees" ADD COLUMN "woocommerce_order_date" timestamp;--> statement-breakpoint
ALTER TABLE "tablecn_attendees" ADD COLUMN "order_status" varchar(20) DEFAULT 'completed';--> statement-breakpoint
ALTER TABLE "tablecn_attendees" ADD COLUMN "is_members_only_ticket" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "tablecn_attendees" ADD COLUMN "source_product_id" varchar(128);--> statement-breakpoint
ALTER TABLE "tablecn_events" ADD COLUMN "merged_product_ids" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "tablecn_events" ADD COLUMN "is_members_only_product" boolean DEFAULT false;--> statement-breakpoint
CREATE INDEX "idx_attendees_event_id" ON "tablecn_attendees" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_attendees_email" ON "tablecn_attendees" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_attendees_checked_in" ON "tablecn_attendees" USING btree ("checked_in");--> statement-breakpoint
CREATE INDEX "idx_attendees_email_checked_in" ON "tablecn_attendees" USING btree ("email","checked_in");--> statement-breakpoint
CREATE INDEX "idx_attendees_order_status" ON "tablecn_attendees" USING btree ("order_status");--> statement-breakpoint
CREATE INDEX "idx_email_logs_member_id" ON "tablecn_email_logs" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_events_event_date" ON "tablecn_events" USING btree ("event_date");--> statement-breakpoint
CREATE INDEX "idx_loops_sync_member_id" ON "tablecn_loops_sync_log" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_loops_sync_email" ON "tablecn_loops_sync_log" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_members_is_active_member" ON "tablecn_members" USING btree ("is_active_member");--> statement-breakpoint
CREATE INDEX "idx_members_membership_expires_at" ON "tablecn_members" USING btree ("membership_expires_at");--> statement-breakpoint
CREATE INDEX "idx_woo_cache_expires_at" ON "tablecn_woocommerce_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_woo_cache_event_id" ON "tablecn_woocommerce_cache" USING btree ("event_id");