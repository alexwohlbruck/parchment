ALTER TABLE "collections" ADD COLUMN "scheme" text DEFAULT 'server-key' NOT NULL;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "resharing_policy" text DEFAULT 'owner-only' NOT NULL;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "public_token" text;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "public_role" text;--> statement-breakpoint
ALTER TABLE "incoming_shares" ADD COLUMN "role" text DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "role" text DEFAULT 'viewer' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "collections_public_token_uq" ON "collections" USING btree ("public_token") WHERE public_token IS NOT NULL;--> statement-breakpoint
-- Backfill: mirror the existing is_sensitive boolean into the new scheme
-- column so existing data keeps its encryption model without a manual flip.
UPDATE "collections" SET "scheme" = 'user-e2ee' WHERE "is_sensitive" = true;