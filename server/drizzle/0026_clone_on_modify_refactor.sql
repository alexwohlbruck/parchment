-- Data-only migration: nuke previously eager-provisioned default layers/groups
-- so they can be re-served from server-side templates under the new
-- clone-on-modify architecture. Custom user layers (no default_template_id)
-- are left untouched. The column drops themselves happen in 0027.

DELETE FROM "layers" WHERE "default_template_id" IS NOT NULL;--> statement-breakpoint
DELETE FROM "layer_groups" WHERE "default_template_id" IS NOT NULL;
