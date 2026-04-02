ALTER TABLE "tablecn_attendees" ADD COLUMN "billing_address" varchar(500);--> statement-breakpoint
ALTER TABLE "tablecn_attendees" ADD COLUMN "billing_city" varchar(128);--> statement-breakpoint
ALTER TABLE "tablecn_attendees" ADD COLUMN "billing_postcode" varchar(20);--> statement-breakpoint
ALTER TABLE "tablecn_attendees" ADD COLUMN "billing_country" varchar(10);--> statement-breakpoint
ALTER TABLE "tablecn_attendees" ADD COLUMN "billing_phone" varchar(50);--> statement-breakpoint
ALTER TABLE "tablecn_attendees" ADD COLUMN "name_resolution_method" varchar(30);