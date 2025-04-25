CREATE TABLE "collections" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text DEFAULT 'folder' NOT NULL,
	"icon_color" text DEFAULT '#3B82F6' NOT NULL,
	"user_id" text NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places_collections" (
	"place_id" text NOT NULL,
	"collection_id" text NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "places_collections_place_id_collection_id_pk" PRIMARY KEY("place_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "saved_places" (
	"id" text PRIMARY KEY NOT NULL,
	"external_ids" jsonb NOT NULL,
	"name" text NOT NULL,
	"icon" text DEFAULT 'map-pin' NOT NULL,
	"icon_color" text DEFAULT '#F43F5E' NOT NULL,
	"preset_type" text,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places_collections" ADD CONSTRAINT "places_collections_place_id_saved_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."saved_places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places_collections" ADD CONSTRAINT "places_collections_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_places" ADD CONSTRAINT "saved_places_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;