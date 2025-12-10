CREATE TABLE "shadcn_woocommerce_cache" (
	"cache_key" varchar(255) PRIMARY KEY NOT NULL,
	"cache_data" jsonb NOT NULL,
	"cached_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"event_id" varchar(30)
);
