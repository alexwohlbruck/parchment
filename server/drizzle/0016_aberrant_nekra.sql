CREATE TABLE "friend_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"from_handle" text NOT NULL,
	"to_handle" text NOT NULL,
	"local_user_id" text,
	"direction" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"origin_server" text NOT NULL,
	"signature" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"friend_handle" text NOT NULL,
	"friend_signing_key" text,
	"friend_encryption_key" text,
	"status" text DEFAULT 'accepted' NOT NULL,
	"established_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "alias" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signing_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "encryption_key" text;--> statement-breakpoint
ALTER TABLE "friend_invitations" ADD CONSTRAINT "friend_invitations_local_user_id_users_id_fk" FOREIGN KEY ("local_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_alias_unique" UNIQUE("alias");