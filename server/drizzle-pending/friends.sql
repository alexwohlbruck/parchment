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
