CREATE TABLE "provider_listing_labels" (
	"provider" text NOT NULL,
	"provider_place_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "provider_listing_labels_provider_provider_place_id_pk" PRIMARY KEY("provider","provider_place_id")
);
