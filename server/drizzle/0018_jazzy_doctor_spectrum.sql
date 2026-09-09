CREATE TABLE IF NOT EXISTS "encrypted_points" (
	"id" text PRIMARY KEY NOT NULL,
	"collection_id" text NOT NULL,
	"user_id" text NOT NULL,
	"encrypted_data" text NOT NULL,
	"nonce" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'collections' AND column_name = 'is_sensitive') THEN ALTER TABLE "collections" ADD COLUMN "is_sensitive" boolean DEFAULT false NOT NULL; END IF; END $$;--> statement-breakpoint
ALTER TABLE "encrypted_points" ADD CONSTRAINT "encrypted_points_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encrypted_points" ADD CONSTRAINT "encrypted_points_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;