CREATE TABLE "incoming_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"sender_handle" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"encrypted_data" text NOT NULL,
	"nonce" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"signature" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"accepted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "shares" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"recipient_handle" text NOT NULL,
	"recipient_user_id" text,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"encrypted_data" text,
	"nonce" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"accepted_at" timestamp,
	"expires_at" timestamp,
	CONSTRAINT "unique_share" UNIQUE("user_id","recipient_handle","resource_type","resource_id")
);
--> statement-breakpoint
ALTER TABLE "incoming_shares" ADD CONSTRAINT "incoming_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_incoming_shares_user" ON "incoming_shares" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_incoming_shares_sender" ON "incoming_shares" USING btree ("sender_handle");--> statement-breakpoint
CREATE INDEX "idx_shares_user" ON "shares" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_shares_recipient" ON "shares" USING btree ("recipient_handle");--> statement-breakpoint
CREATE INDEX "idx_shares_resource" ON "shares" USING btree ("resource_type","resource_id");