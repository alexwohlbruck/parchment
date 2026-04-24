CREATE TABLE "encrypted_user_blobs" (
	"user_id" text NOT NULL,
	"blob_type" text NOT NULL,
	"encrypted_blob" text NOT NULL,
	"nonce" text NOT NULL,
	"km_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "encrypted_user_blobs_user_id_blob_type_pk" PRIMARY KEY("user_id","blob_type")
);
--> statement-breakpoint
ALTER TABLE "encrypted_user_blobs" ADD CONSTRAINT "encrypted_user_blobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;