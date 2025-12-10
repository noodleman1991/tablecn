ALTER TABLE "shadcn_members" ADD COLUMN "manually_added" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shadcn_members" ADD COLUMN "manual_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "shadcn_members" ADD COLUMN "notes" varchar(1000);