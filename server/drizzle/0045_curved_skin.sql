CREATE TABLE "pending_revocations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"peer_handle" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_revocations" ADD CONSTRAINT "pending_revocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_revocations_user_peer_uq" ON "pending_revocations" USING btree ("user_id","peer_handle");