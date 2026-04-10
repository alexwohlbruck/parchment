CREATE TABLE "default_layer_user_state" (
	"user_id" text NOT NULL,
	"template_id" text NOT NULL,
	"type" text NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"visible" boolean,
	"order" integer,
	"enabled" boolean,
	"group_id" text,
	"parent_group_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "default_layer_user_state_pkey" PRIMARY KEY("user_id","template_id","type")
);
--> statement-breakpoint
ALTER TABLE "layers" DROP CONSTRAINT "layers_group_id_layer_groups_id_fk";
--> statement-breakpoint
ALTER TABLE "layer_groups" ADD COLUMN "cloned_from_template_id" text;--> statement-breakpoint
ALTER TABLE "layers" ADD COLUMN "cloned_from_template_id" text;--> statement-breakpoint
ALTER TABLE "default_layer_user_state" ADD CONSTRAINT "default_layer_user_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_groups" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "layer_groups" DROP COLUMN "default_template_id";--> statement-breakpoint
ALTER TABLE "layers" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "layers" DROP COLUMN "default_template_id";