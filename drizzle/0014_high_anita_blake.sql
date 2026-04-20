CREATE TABLE "tablecn_member_email_aliases" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"member_id" varchar(30),
	"status" varchar(20) NOT NULL,
	"source" varchar(30) NOT NULL,
	"notes" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT current_timestamp,
	CONSTRAINT "tablecn_member_email_aliases_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "idx_member_email_aliases_member_id" ON "tablecn_member_email_aliases" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_member_email_aliases_status" ON "tablecn_member_email_aliases" USING btree ("status");