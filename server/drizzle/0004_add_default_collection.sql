-- Add isDefault field to collections table
ALTER TABLE collections ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT false;

-- Create a default collection for each user
INSERT INTO collections (id, name, icon, icon_color, user_id, is_public, is_default, created_at, updated_at)
SELECT 
  gen_random_uuid()::text, 
  'Bookmarks', 
  'bookmark', 
  '#3B82F6', 
  user_id, 
  false, 
  true, 
  NOW(), 
  NOW()
FROM users
WHERE NOT EXISTS (
  SELECT 1 FROM collections WHERE collections.user_id = users.id AND collections.is_default = true
);

-- Add default collection
INSERT INTO collections (id, name, description, icon, icon_color, is_public, is_default, user_id, created_at, updated_at)
VALUES (
  'default',
  'Bookmarks',
  'Your bookmarks',
  'bookmark',
  'blue',
  false,
  true,
  'default',
  NOW(),
  NOW()
); 