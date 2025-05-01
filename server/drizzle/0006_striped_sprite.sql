ALTER TABLE "saved_places" RENAME TO "bookmarks";--> statement-breakpoint
ALTER TABLE "places_collections" RENAME TO "bookmarks_collections";--> statement-breakpoint
ALTER TABLE "bookmarks_collections" RENAME COLUMN "place_id" TO "bookmark_id";--> statement-breakpoint
ALTER TABLE "bookmarks_collections" DROP CONSTRAINT "places_collections_place_id_saved_places_id_fk";
--> statement-breakpoint
ALTER TABLE "bookmarks_collections" DROP CONSTRAINT "places_collections_collection_id_collections_id_fk";
--> statement-breakpoint
ALTER TABLE "bookmarks" DROP CONSTRAINT "saved_places_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "bookmarks_collections" DROP CONSTRAINT "places_collections_place_id_collection_id_pk";--> statement-breakpoint
ALTER TABLE "bookmarks_collections" ADD CONSTRAINT "bookmarks_collections_bookmark_id_collection_id_pk" PRIMARY KEY("bookmark_id","collection_id");--> statement-breakpoint
ALTER TABLE "bookmarks_collections" ADD CONSTRAINT "bookmarks_collections_bookmark_id_bookmarks_id_fk" FOREIGN KEY ("bookmark_id") REFERENCES "public"."bookmarks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks_collections" ADD CONSTRAINT "bookmarks_collections_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;