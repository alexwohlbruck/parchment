ALTER TABLE "users" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "first_name_encrypted";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "last_name_encrypted";