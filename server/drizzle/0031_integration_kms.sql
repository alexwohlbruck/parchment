-- Part C.5: integration credentials are now encrypted at rest under a
-- server-side KMS key. Existing cleartext `config` rows cannot be migrated
-- by SQL alone (they need the KMS key + JSON round-trip), so we drop them
-- here and require operators to re-add integrations through the normal
-- UI/API path — which will encrypt on the way in. Safe for this unreleased
-- app; for released deployments this migration would instead run a JS
-- shim that encrypts-in-place.
DELETE FROM "integrations";--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "config_ciphertext" text NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "config_nonce" text NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "config_key_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" DROP COLUMN "config";