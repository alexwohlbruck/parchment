CREATE TABLE "ask_usage" (
	"user_id" text NOT NULL,
	"month" text NOT NULL,
	"key_source" text NOT NULL,
	"questions" integer DEFAULT 0 NOT NULL,
	"prompt_tokens" bigint DEFAULT 0 NOT NULL,
	"completion_tokens" bigint DEFAULT 0 NOT NULL,
	"cost" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ask_usage_user_id_month_key_source_pk" PRIMARY KEY("user_id","month","key_source")
);
--> statement-breakpoint
ALTER TABLE "ask_usage" ADD CONSTRAINT "ask_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;