ALTER TABLE "token" RENAME COLUMN "token" TO "value";--> statement-breakpoint
ALTER TABLE "token" ALTER COLUMN "value" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "token" ADD COLUMN "hash" text;