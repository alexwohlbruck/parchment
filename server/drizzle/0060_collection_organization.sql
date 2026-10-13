CREATE TABLE "collection_organizations" (
	"user_id" text PRIMARY KEY NOT NULL,
	"groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"placements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collection_organizations" ADD CONSTRAINT "collection_organizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;