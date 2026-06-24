CREATE TABLE "planned_trips" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"request" jsonb NOT NULL,
	"trip" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "planned_trips" ADD CONSTRAINT "planned_trips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_planned_trips_expires" ON "planned_trips" USING btree ("expires_at");