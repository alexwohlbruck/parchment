ALTER TABLE "incoming_shares" ADD COLUMN "share_id" text;
--> statement-breakpoint
ALTER TABLE "incoming_shares"
  ADD CONSTRAINT "incoming_shares_share_id_shares_id_fk"
  FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE cascade;
--> statement-breakpoint
UPDATE "incoming_shares" i
SET "share_id" = s."id"
FROM "shares" s
JOIN "collections" c ON c."id" = s."resource_id" AND c."user_id" = s."user_id"
WHERE s."recipient_user_id" = i."user_id"
  AND s."resource_type" = i."resource_type"
  AND s."resource_id" = i."resource_id"
  AND s."resource_type" = 'collection'
  AND i."share_id" IS NULL;
--> statement-breakpoint
DELETE FROM "incoming_shares" i
WHERE i."share_id" IS NULL
  AND EXISTS (SELECT 1 FROM "collections" c WHERE c."id" = i."resource_id");
--> statement-breakpoint
DELETE FROM "incoming_shares" a
USING "incoming_shares" b
WHERE a."user_id" = b."user_id"
  AND a."sender_handle" = b."sender_handle"
  AND a."resource_type" = b."resource_type"
  AND a."resource_id" = b."resource_id"
  AND (a."created_at", a."id") < (b."created_at", b."id");
--> statement-breakpoint
CREATE UNIQUE INDEX "unique_incoming_share_mirror" ON "incoming_shares" ("share_id");
--> statement-breakpoint
ALTER TABLE "incoming_shares"
  ADD CONSTRAINT "unique_incoming_share"
  UNIQUE ("user_id", "sender_handle", "resource_type", "resource_id");
--> statement-breakpoint
DELETE FROM "shares" a
USING "shares" b
WHERE a."user_id" = b."user_id"
  AND a."recipient_user_id" = b."recipient_user_id"
  AND a."resource_type" = b."resource_type"
  AND a."resource_id" = b."resource_id"
  AND (a."created_at", a."id") < (b."created_at", b."id");
--> statement-breakpoint
ALTER TABLE "shares"
  ADD CONSTRAINT "unique_share_local_recipient"
  UNIQUE ("user_id", "recipient_user_id", "resource_type", "resource_id");
--> statement-breakpoint
ALTER TABLE "shares" DROP CONSTRAINT "shares_recipient_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "shares"
  ADD CONSTRAINT "shares_recipient_user_id_users_id_fk"
  FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
--> statement-breakpoint
DELETE FROM friendships f
USING friendships keep
WHERE f.user_id = keep.user_id
  AND f.friend_handle = keep.friend_handle
  AND (keep.created_at, keep.id) < (f.created_at, f.id);
--> statement-breakpoint
ALTER TABLE friendships
  ADD CONSTRAINT unique_friendship UNIQUE (user_id, friend_handle);
--> statement-breakpoint
DELETE FROM friend_invitations i
USING friendships f
WHERE i.status = 'pending'
  AND i.local_user_id = f.user_id
  AND (i.from_handle = f.friend_handle OR i.to_handle = f.friend_handle);
--> statement-breakpoint
DELETE FROM location_sharing_config c
USING friendships f, location_sharing_config ok
WHERE f.user_id = c.user_id
  AND lower(f.friend_handle) = c.friend_handle
  AND f.friend_handle <> c.friend_handle
  AND ok.user_id = c.user_id AND ok.friend_handle = f.friend_handle;
--> statement-breakpoint
UPDATE location_sharing_config c SET friend_handle = f.friend_handle
FROM friendships f
WHERE f.user_id = c.user_id
  AND lower(f.friend_handle) = c.friend_handle
  AND f.friend_handle <> c.friend_handle;
--> statement-breakpoint
DELETE FROM encrypted_locations e
USING friendships f, encrypted_locations ok
WHERE f.user_id = e.user_id
  AND lower(f.friend_handle) = e.for_friend_handle
  AND f.friend_handle <> e.for_friend_handle
  AND ok.user_id = e.user_id AND ok.for_friend_handle = f.friend_handle;
--> statement-breakpoint
UPDATE encrypted_locations e SET for_friend_handle = f.friend_handle
FROM friendships f
WHERE f.user_id = e.user_id
  AND lower(f.friend_handle) = e.for_friend_handle
  AND f.friend_handle <> e.for_friend_handle;
--> statement-breakpoint
UPDATE friend_invitations
SET expires_at = now() + interval '30 days'
WHERE status = 'pending' AND expires_at IS NULL;
