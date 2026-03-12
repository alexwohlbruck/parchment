CREATE INDEX IF NOT EXISTS "idx_bookmarks_name_trgm" ON "bookmarks" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bookmarks_address_trgm" ON "bookmarks" USING gin ("address" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bookmarks_preset_trgm" ON "bookmarks" USING gin ("preset_type" gin_trgm_ops);