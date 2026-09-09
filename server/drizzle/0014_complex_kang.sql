DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_bookmarks_name_trgm') THEN
    CREATE INDEX "idx_bookmarks_name_trgm" ON "bookmarks" USING gin ("name" gin_trgm_ops);
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_bookmarks_address_trgm') THEN
    CREATE INDEX "idx_bookmarks_address_trgm" ON "bookmarks" USING gin ("address" gin_trgm_ops);
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_bookmarks_preset_trgm') THEN
    CREATE INDEX "idx_bookmarks_preset_trgm" ON "bookmarks" USING gin ("preset_type" gin_trgm_ops);
  END IF;
END $$;
