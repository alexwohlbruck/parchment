CREATE TABLE "place_provider_matches" (
	"source" text NOT NULL,
	"place_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_place_id" text NOT NULL,
	"matched_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "place_provider_matches_source_place_id_provider_pk" PRIMARY KEY("source","place_id","provider")
);
