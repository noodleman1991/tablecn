CREATE TABLE "tablecn_product_swap_map" (
	"product_id" varchar(128) PRIMARY KEY NOT NULL,
	"is_swapped" boolean DEFAULT false NOT NULL,
	"detection_method" varchar(20) NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT current_timestamp
);
