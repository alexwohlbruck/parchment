-- Pending SQL for the e2ee-audit-friends branch. Fold into the next generated
-- migration (bun run generate) and keep the data fixes ahead of the DDL.

-- 1. One friendship row per (user, friend). Keep the oldest duplicate.
DELETE FROM friendships f
USING friendships keep
WHERE f.user_id = keep.user_id
  AND f.friend_handle = keep.friend_handle
  AND (keep.created_at, keep.id) < (f.created_at, f.id);

ALTER TABLE friendships
  ADD CONSTRAINT unique_friendship UNIQUE (user_id, friend_handle);

-- Pending invitations made redundant by an existing friendship.
DELETE FROM friend_invitations i
USING friendships f
WHERE i.status = 'pending'
  AND i.local_user_id = f.user_id
  AND (i.from_handle = f.friend_handle OR i.to_handle = f.friend_handle);

-- 2. Location rows were written with a lowercased friend handle while
-- friendships keep the alias's own casing. Re-case them to the friendship's
-- handle so sharing with mixed-case aliases starts working. Rows that would
-- collide with an already-correct row are dropped first.
DELETE FROM location_sharing_config c
USING friendships f, location_sharing_config ok
WHERE f.user_id = c.user_id
  AND lower(f.friend_handle) = c.friend_handle
  AND f.friend_handle <> c.friend_handle
  AND ok.user_id = c.user_id AND ok.friend_handle = f.friend_handle;
UPDATE location_sharing_config c SET friend_handle = f.friend_handle
FROM friendships f
WHERE f.user_id = c.user_id
  AND lower(f.friend_handle) = c.friend_handle
  AND f.friend_handle <> c.friend_handle;

DELETE FROM encrypted_locations e
USING friendships f, encrypted_locations ok
WHERE f.user_id = e.user_id
  AND lower(f.friend_handle) = e.for_friend_handle
  AND f.friend_handle <> e.for_friend_handle
  AND ok.user_id = e.user_id AND ok.for_friend_handle = f.friend_handle;
UPDATE encrypted_locations e SET for_friend_handle = f.friend_handle
FROM friendships f
WHERE f.user_id = e.user_id
  AND lower(f.friend_handle) = e.for_friend_handle
  AND f.friend_handle <> e.for_friend_handle;

-- 3. Invitations now expire after 30 days. Give existing pending rows the
-- same window from today rather than expiring them all at once.
UPDATE friend_invitations
SET expires_at = now() + interval '30 days'
WHERE status = 'pending' AND expires_at IS NULL;
