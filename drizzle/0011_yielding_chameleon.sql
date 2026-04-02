CREATE TABLE "tablecn_resync_runs" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"job_type" varchar(30) NOT NULL,
	"status" varchar(20) NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"start_offset" integer DEFAULT 0 NOT NULL,
	"error_message" varchar(500),
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL
);
