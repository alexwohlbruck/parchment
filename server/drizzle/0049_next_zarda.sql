ALTER TABLE "roles_permissions" ADD COLUMN "is_default" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "is_default" boolean DEFAULT true NOT NULL;