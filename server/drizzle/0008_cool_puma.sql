ALTER TABLE "session" ALTER COLUMN "ipv4" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "ipv4" SET NOT NULL;