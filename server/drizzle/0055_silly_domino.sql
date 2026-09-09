ALTER TABLE "canvases" ALTER COLUMN "metadata_encrypted" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "canvases" ADD COLUMN "scheme" text DEFAULT 'server-key' NOT NULL;--> statement-breakpoint
ALTER TABLE "canvases" ADD COLUMN "resharing_policy" text DEFAULT 'owner-only' NOT NULL;--> statement-breakpoint
ALTER TABLE "canvases" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "canvases" ADD COLUMN "public_token" text;--> statement-breakpoint
ALTER TABLE "canvases" ADD COLUMN "public_role" text;--> statement-breakpoint
ALTER TABLE "canvases" ADD COLUMN "body" jsonb;--> statement-breakpoint
ALTER TABLE "canvases" ADD COLUMN "body_encrypted" text;--> statement-breakpoint
CREATE INDEX "idx_canvases_user" ON "canvases" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "canvases_public_token_uq" ON "canvases" USING btree ("public_token") WHERE public_token IS NOT NULL;