CREATE TABLE "tablecn_loops_sync_log" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"member_id" varchar(30),
	"email" varchar(255) NOT NULL,
	"operation" varchar(20) NOT NULL,
	"status" varchar(20) NOT NULL,
	"error_message" varchar(1000),
	"loops_contact_id" varchar(128),
	"synced_at" timestamp DEFAULT now() NOT NULL
);
