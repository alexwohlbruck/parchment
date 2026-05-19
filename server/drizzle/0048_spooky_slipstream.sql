ALTER TABLE "users" ADD COLUMN "polar_customer_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_polar_customer_id_unique" UNIQUE("polar_customer_id");