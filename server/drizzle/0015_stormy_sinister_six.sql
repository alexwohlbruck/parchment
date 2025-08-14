CREATE TABLE "layer_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"show_in_layer_selector" boolean DEFAULT true NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"icon" text,
	"order" integer NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "layers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'custom' NOT NULL,
	"engine" text[] DEFAULT '{"mapbox","maplibre"}' NOT NULL,
	"show_in_layer_selector" boolean DEFAULT true NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"icon" text,
	"order" integer NOT NULL,
	"group_id" text,
	"configuration" jsonb NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "layer_groups" ADD CONSTRAINT "layer_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layers" ADD CONSTRAINT "layers_group_id_layer_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."layer_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layers" ADD CONSTRAINT "layers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;