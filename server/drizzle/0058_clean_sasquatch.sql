CREATE TYPE "public"."osm_edit_action" AS ENUM('create', 'modify');--> statement-breakpoint
CREATE TABLE "osm_edits" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"action" "osm_edit_action" NOT NULL,
	"osm_type" text NOT NULL,
	"osm_id" text NOT NULL,
	"version" integer,
	"changeset_id" text NOT NULL,
	"tags" jsonb NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "osm_edits" ADD CONSTRAINT "osm_edits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;