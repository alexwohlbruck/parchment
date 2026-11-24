-- Sharing ACL hardening, on top of 0065. Run once, in order.

-- 1. Bind same-server incoming shares to the outgoing share they mirror.
ALTER TABLE "incoming_shares" ADD COLUMN "share_id" text;
ALTER TABLE "incoming_shares"
  ADD CONSTRAINT "incoming_shares_share_id_shares_id_fk"
  FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE cascade;

-- Backfill: match on recipient + resource, keeping only shares made by the
-- resource's owner (collections are the only type with local access).
UPDATE "incoming_shares" i
SET "share_id" = s."id"
FROM "shares" s
JOIN "collections" c ON c."id" = s."resource_id" AND c."user_id" = s."user_id"
WHERE s."recipient_user_id" = i."user_id"
  AND s."resource_type" = i."resource_type"
  AND s."resource_id" = i."resource_id"
  AND s."resource_type" = 'collection'
  AND i."share_id" IS NULL;

-- Rows naming a local collection that match no owner's share grant nothing
-- now; drop them. Remote-delivered rows name ids on the peer, not here.
DELETE FROM "incoming_shares" i
WHERE i."share_id" IS NULL
  AND EXISTS (SELECT 1 FROM "collections" c WHERE c."id" = i."resource_id");

-- 2. One mirror per share, one incoming row per (recipient, sender, resource).
DELETE FROM "incoming_shares" a
USING "incoming_shares" b
WHERE a."user_id" = b."user_id"
  AND a."sender_handle" = b."sender_handle"
  AND a."resource_type" = b."resource_type"
  AND a."resource_id" = b."resource_id"
  AND (a."created_at", a."id") < (b."created_at", b."id");
CREATE UNIQUE INDEX "unique_incoming_share_mirror" ON "incoming_shares" ("share_id");
ALTER TABLE "incoming_shares"
  ADD CONSTRAINT "unique_incoming_share"
  UNIQUE ("user_id", "sender_handle", "resource_type", "resource_id");

-- 3. One outgoing share per local recipient user, even across alias changes.
DELETE FROM "shares" a
USING "shares" b
WHERE a."user_id" = b."user_id"
  AND a."recipient_user_id" = b."recipient_user_id"
  AND a."resource_type" = b."resource_type"
  AND a."resource_id" = b."resource_id"
  AND (a."created_at", a."id") < (b."created_at", b."id");
ALTER TABLE "shares"
  ADD CONSTRAINT "unique_share_local_recipient"
  UNIQUE ("user_id", "recipient_user_id", "resource_type", "resource_id");

-- 4. Deleting a user drops the shares made to them.
ALTER TABLE "shares" DROP CONSTRAINT "shares_recipient_user_id_users_id_fk";
ALTER TABLE "shares"
  ADD CONSTRAINT "shares_recipient_user_id_users_id_fk"
  FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
