CREATE TABLE "wrapped_master_keys" (
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"wrapped_km" text NOT NULL,
	"wrap_algo" text DEFAULT 'aes-256-gcm-prf-v1' NOT NULL,
	"slot_signature" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	CONSTRAINT "wrapped_master_keys_user_id_credential_id_pk" PRIMARY KEY("user_id","credential_id")
);
--> statement-breakpoint
ALTER TABLE "wrapped_master_keys" ADD CONSTRAINT "wrapped_master_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wrapped_master_keys" ADD CONSTRAINT "wrapped_master_keys_credential_id_passkeys_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."passkeys"("id") ON DELETE cascade ON UPDATE no action;