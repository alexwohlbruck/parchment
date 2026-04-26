ALTER TABLE "integrations" ALTER COLUMN "config_ciphertext" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ALTER COLUMN "config_nonce" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "scheme" text DEFAULT 'server-key' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_user_scheme_uq" ON "integrations" USING btree ("user_id","integration_id","scheme") WHERE user_id IS NOT NULL;