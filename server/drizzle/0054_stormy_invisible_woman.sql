ALTER TABLE "default_layer_user_state" ALTER COLUMN "hidden" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "default_layer_user_state" ALTER COLUMN "hidden" DROP NOT NULL;--> statement-breakpoint
-- `hidden` used to be NOT NULL, so every state row carried `false` whether or
-- not the user had ever made a choice about it. NULL now means "follow the
-- template's installedByDefault", so collapse those incidental `false`s back
-- to NULL. Real removals (`true`) are untouched.
UPDATE "default_layer_user_state" SET "hidden" = NULL WHERE "hidden" = false;--> statement-breakpoint
ALTER TABLE "default_layer_user_state" ADD COLUMN "show_in_layer_selector" boolean;--> statement-breakpoint
ALTER TABLE "layer_groups" DROP COLUMN "cloned_from_template_id";--> statement-breakpoint
ALTER TABLE "layers" DROP COLUMN "cloned_from_template_id";