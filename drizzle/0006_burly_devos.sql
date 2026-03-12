CREATE TABLE "tablecn_validation_results" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"run_at" timestamp NOT NULL,
	"mode" varchar(10) NOT NULL,
	"period_from" timestamp NOT NULL,
	"period_to" timestamp NOT NULL,
	"results" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tablecn_attendees" ADD COLUMN "ticket_type" varchar(100);--> statement-breakpoint
ALTER TABLE "tablecn_attendees" ADD COLUMN "order_total" real;--> statement-breakpoint
ALTER TABLE "tablecn_email_logs" DROP COLUMN "resend_id";