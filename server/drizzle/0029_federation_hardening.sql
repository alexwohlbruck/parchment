CREATE TABLE "federated_server_keys" (
	"server_id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"minimum_protocol_version" integer DEFAULT 2 NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "federation_nonces" (
	"sender_server_id" text NOT NULL,
	"nonce" text NOT NULL,
	"timestamp" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_friend_pins" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"friend_handle" text NOT NULL,
	"encrypted_pin" text NOT NULL,
	"nonce" text NOT NULL,
	"pin_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "federated_server" CASCADE;--> statement-breakpoint
ALTER TABLE "friendships" ADD COLUMN "revoked_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "federation_nonces_sender_nonce_uq" ON "federation_nonces" USING btree ("sender_server_id","nonce");--> statement-breakpoint
CREATE INDEX "federation_nonces_created_at_idx" ON "federation_nonces" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_friend_pins_user_friend_uq" ON "user_friend_pins" USING btree ("user_id","friend_handle");