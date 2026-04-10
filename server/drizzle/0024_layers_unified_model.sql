ALTER TABLE "layer_groups" ADD COLUMN "fade_basemap" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "layer_groups" ADD COLUMN "category" text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "layer_groups" ADD COLUMN "default_template_id" text;--> statement-breakpoint
ALTER TABLE "layer_groups" ADD COLUMN "parent_group_id" text;--> statement-breakpoint
ALTER TABLE "layers" ADD COLUMN "fade_basemap" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "layers" ADD COLUMN "category" text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "layers" ADD COLUMN "default_template_id" text;--> statement-breakpoint
ALTER TABLE "layers" ADD COLUMN "is_sub_layer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "layers" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "layers" ADD COLUMN "integration_id" text;