DROP TABLE "location_event" CASCADE;--> statement-breakpoint
DROP TABLE "location_history" CASCADE;--> statement-breakpoint
ALTER TABLE "location_sharing_relationship" DROP COLUMN "shared_key_encrypted";--> statement-breakpoint
ALTER TABLE "location_sharing_relationship" DROP COLUMN "key_exchange_version";