-- Location Sharing Schema Migration
-- This adds support for location sharing, E2E encryption, device tracking, and federation

-- User Encryption Keys table
CREATE TABLE IF NOT EXISTS "user_encryption_key" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL UNIQUE,
	"public_key" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- User Devices table (user's own devices for multi-device support)
CREATE TABLE IF NOT EXISTS "user_device" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_name" text NOT NULL,
	"device_type" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Location Sharing Relationships table
CREATE TABLE IF NOT EXISTS "location_sharing_relationship" (
	"id" text PRIMARY KEY NOT NULL,
	"sharer_id" text NOT NULL,
	"sharer_server_url" text,
	"viewer_id" text,
	"viewer_server_url" text,
	"viewer_federated_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"precision_level" text DEFAULT 'exact' NOT NULL,
	"is_cross_server" boolean DEFAULT false NOT NULL,
	"shared_key_encrypted" text,
	"key_exchange_version" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp,
	"shared_properties" jsonb DEFAULT '{"speed":true,"activityType":true,"altitude":true,"course":true}',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_sharing_relationship" UNIQUE("sharer_id", "viewer_id", "viewer_federated_id")
);
--> statement-breakpoint

-- Location Events table (encrypted location history)
CREATE TABLE IF NOT EXISTS "location_event" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"relationship_id" text NOT NULL,
	"encrypted_data" text NOT NULL,
	"encryption_version" integer DEFAULT 1 NOT NULL,
	"entity_type" text DEFAULT 'person' NOT NULL,
	"entity_id" text,
	"approximate_timestamp" timestamp NOT NULL,
	"approximate_lat" numeric(10, 4),
	"approximate_lng" numeric(10, 4),
	"tracking_mode" text DEFAULT 'battery-efficient' NOT NULL,
	"device_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Tracked Devices table (third-party device tracking)
CREATE TABLE IF NOT EXISTS "tracked_device" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"device_type" text NOT NULL,
	"device_name" text NOT NULL,
	"external_device_id" text NOT NULL,
	"icon" text DEFAULT 'map-pin' NOT NULL,
	"icon_color" text DEFAULT '#3B82F6' NOT NULL,
	"is_shared" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}',
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Federated Servers table
CREATE TABLE IF NOT EXISTS "federated_server" (
	"id" text PRIMARY KEY NOT NULL,
	"server_url" text NOT NULL UNIQUE,
	"server_name" text,
	"public_key" text,
	"verified" boolean DEFAULT false NOT NULL,
	"last_contacted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Foreign Keys
DO $$ BEGIN
 ALTER TABLE "user_encryption_key" ADD CONSTRAINT "user_encryption_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "user_device" ADD CONSTRAINT "user_device_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "location_sharing_relationship" ADD CONSTRAINT "location_sharing_relationship_sharer_id_user_id_fk" FOREIGN KEY ("sharer_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "location_sharing_relationship" ADD CONSTRAINT "location_sharing_relationship_viewer_id_user_id_fk" FOREIGN KEY ("viewer_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "location_event" ADD CONSTRAINT "location_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "location_event" ADD CONSTRAINT "location_event_relationship_id_location_sharing_relationship_id_fk" FOREIGN KEY ("relationship_id") REFERENCES "location_sharing_relationship"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "location_event" ADD CONSTRAINT "location_event_device_id_user_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "user_device"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "tracked_device" ADD CONSTRAINT "tracked_device_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "tracked_device" ADD CONSTRAINT "tracked_device_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "integration"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_user_devices_user_id" ON "user_device" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sharing_sharer" ON "location_sharing_relationship" ("sharer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sharing_viewer" ON "location_sharing_relationship" ("viewer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sharing_status" ON "location_sharing_relationship" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_location_user_relationship_timestamp" ON "location_event" ("user_id", "relationship_id", "approximate_timestamp" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_location_user_timestamp" ON "location_event" ("user_id", "approximate_timestamp" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_location_entity" ON "location_event" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tracked_devices_user" ON "tracked_device" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tracked_devices_integration" ON "tracked_device" ("integration_id");


