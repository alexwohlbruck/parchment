CREATE TABLE IF NOT EXISTS "user_vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"energy_type" text,
	"name" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"last_known_lat" double precision,
	"last_known_lng" double precision,
	"location_source" text DEFAULT 'manual' NOT NULL,
	"location_updated_at" timestamp,
	"tracker_device_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_vehicles" ADD CONSTRAINT "user_vehicles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_vehicles_user_id_idx" ON "user_vehicles" USING btree ("user_id");
