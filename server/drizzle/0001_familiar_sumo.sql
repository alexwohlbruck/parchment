ALTER TABLE "permission" DROP COLUMN IF EXISTS "created_at";--> statement-breakpoint
ALTER TABLE "permission" DROP COLUMN IF EXISTS "updated_at";--> statement-breakpoint
ALTER TABLE "role" DROP COLUMN IF EXISTS "created_at";--> statement-breakpoint
ALTER TABLE "role" DROP COLUMN IF EXISTS "updated_at";