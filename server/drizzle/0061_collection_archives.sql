CREATE TABLE "collection_archives" (
	"user_id" text NOT NULL,
	"collection_id" text NOT NULL,
	"archived_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "collection_archives_user_id_collection_id_pk" PRIMARY KEY("user_id","collection_id")
);
--> statement-breakpoint
ALTER TABLE "collection_archives" ADD CONSTRAINT "collection_archives_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_archives" ADD CONSTRAINT "collection_archives_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;