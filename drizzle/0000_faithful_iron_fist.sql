CREATE TABLE "shadcn_attendees" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"event_id" varchar(30) NOT NULL,
	"email" varchar(255) NOT NULL,
	"first_name" varchar(128),
	"last_name" varchar(128),
	"woocommerce_order_id" varchar(128),
	"checked_in" boolean DEFAULT false NOT NULL,
	"checked_in_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT current_timestamp
);
--> statement-breakpoint
CREATE TABLE "shadcn_email_logs" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"member_id" varchar(30) NOT NULL,
	"email_type" varchar(50) NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"resend_id" varchar(255),
	"status" varchar(30) DEFAULT 'sent' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shadcn_events" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"event_date" timestamp NOT NULL,
	"woocommerce_product_id" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT current_timestamp
);
--> statement-breakpoint
CREATE TABLE "shadcn_members" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"first_name" varchar(128),
	"last_name" varchar(128),
	"is_active_member" boolean DEFAULT false NOT NULL,
	"total_events_attended" real DEFAULT 0 NOT NULL,
	"membership_expires_at" timestamp,
	"last_event_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT current_timestamp,
	CONSTRAINT "shadcn_members_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "shadcn_tasks" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"code" varchar(128) NOT NULL,
	"title" varchar(128),
	"status" varchar(30) DEFAULT 'todo' NOT NULL,
	"label" varchar(30) DEFAULT 'bug' NOT NULL,
	"priority" varchar(30) DEFAULT 'low' NOT NULL,
	"estimated_hours" real DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT current_timestamp,
	CONSTRAINT "shadcn_tasks_code_unique" UNIQUE("code")
);
