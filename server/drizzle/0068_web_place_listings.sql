CREATE TYPE "public"."web_place_listing_resolution" AS ENUM('added', 'noted', 'auto-noted', 'mapped', 'already-noted', 'no-account', 'failed');--> statement-breakpoint
CREATE TABLE "web_place_listings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"place" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"resolved_at" timestamp,
	"resolution" "web_place_listing_resolution",
	"note_id" bigint
);
--> statement-breakpoint
ALTER TABLE "web_place_listings" ADD CONSTRAINT "web_place_listings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;