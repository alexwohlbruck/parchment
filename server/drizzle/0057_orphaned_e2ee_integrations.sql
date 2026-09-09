-- Accounts reset before the reset path cleared them are left with a
-- user-e2ee integrations row whose config blob is gone. The row reads as
-- configured, decrypts to nothing, and blocks a reconnect via
-- integrations_user_scheme_uq.
--
-- The age guard exists because a create is two steps: the metadata row
-- lands first, the client PUTs the blob after. A row minutes old may be
-- mid-create rather than orphaned.
DELETE FROM "integrations" i
WHERE i."scheme" = 'user-e2ee'
  AND i."user_id" IS NOT NULL
  AND i."created_at" < now() - interval '1 hour'
  AND NOT EXISTS (
    SELECT 1 FROM "encrypted_user_blobs" b
    WHERE b."user_id" = i."user_id"
      AND b."blob_type" = 'integration-config:' || i."integration_id"
  );
