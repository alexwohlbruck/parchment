CREATE TABLE "segment_stats" (
	"segment_id" text NOT NULL,
	"speed_bucket" integer NOT NULL,
	"time_bucket" integer NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "segment_stats_segment_id_speed_bucket_time_bucket_pk" PRIMARY KEY("segment_id","speed_bucket","time_bucket")
);
