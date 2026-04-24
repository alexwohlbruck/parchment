CREATE TABLE "device_transfer_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"receiver_ephemeral_pub" text NOT NULL,
	"sender_ephemeral_pub" text,
	"sealed_seed" text,
	"sender_signature" text,
	"consumed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_transfer_sessions" ADD CONSTRAINT "device_transfer_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;