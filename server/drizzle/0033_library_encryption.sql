CREATE TABLE "canvases" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"metadata_encrypted" text NOT NULL,
	"metadata_key_version" integer DEFAULT 1 NOT NULL,
	"future_crdt_format_version" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "metadata_encrypted" text;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "metadata_key_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;