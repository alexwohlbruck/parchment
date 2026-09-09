CREATE TABLE "routes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mode" text DEFAULT 'walking' NOT NULL,
	"scheme" text DEFAULT 'server-key' NOT NULL,
	"resharing_policy" text DEFAULT 'owner-only' NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"public_token" text,
	"public_role" text,
	"metadata_encrypted" text,
	"metadata_key_version" integer DEFAULT 1 NOT NULL,
	"body" jsonb,
	"distance" double precision,
	"duration" double precision,
	"elevation_gain" double precision,
	"elevation_loss" double precision,
	"body_encrypted" text,
	"body_nonce" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_routes_user" ON "routes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "routes_public_token_uq" ON "routes" USING btree ("public_token") WHERE public_token IS NOT NULL;