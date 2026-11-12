ALTER TABLE "canvases" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "default_layer_user_state" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "layer_groups" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "layers" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "archived_at" timestamp;