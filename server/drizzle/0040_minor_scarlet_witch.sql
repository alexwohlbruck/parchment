CREATE TABLE "device_wrap_secrets" (
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"secret" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"rotated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "device_wrap_secrets_user_id_device_id_pk" PRIMARY KEY("user_id","device_id")
);
--> statement-breakpoint
ALTER TABLE "device_wrap_secrets" ADD CONSTRAINT "device_wrap_secrets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_wrap_secrets_user_id_idx" ON "device_wrap_secrets" USING btree ("user_id");