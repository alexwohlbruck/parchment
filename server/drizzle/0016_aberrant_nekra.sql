CREATE TABLE IF NOT EXISTS "friend_invitations" (
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
CREATE TABLE IF NOT EXISTS "friendships" (
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
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'alias') THEN ALTER TABLE "users" ADD COLUMN "alias" text; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'signing_key') THEN ALTER TABLE "users" ADD COLUMN "signing_key" text; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'encryption_key') THEN ALTER TABLE "users" ADD COLUMN "encryption_key" text; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friend_invitations_local_user_id_users_id_fk') THEN ALTER TABLE "friend_invitations" ADD CONSTRAINT "friend_invitations_local_user_id_users_id_fk" FOREIGN KEY ("local_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friendships_user_id_users_id_fk') THEN ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_alias_unique') THEN ALTER TABLE "users" ADD CONSTRAINT "users_alias_unique" UNIQUE("alias"); END IF; END $$;