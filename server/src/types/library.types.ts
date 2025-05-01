import {
  bookmarks,
  collections,
  bookmarksCollections,
} from '../schema/library.schema'

export type Bookmark = typeof bookmarks.$inferSelect
export type NewBookmark = typeof bookmarks.$inferInsert
export type Collection = typeof collections.$inferSelect
export type NewCollection = typeof collections.$inferInsert
export type BookmarkCollection = typeof bookmarksCollections.$inferSelect
export type NewBookmarkCollection = typeof bookmarksCollections.$inferInsert

export type CreateBookmarkParams = {
  externalIds: Record<string, string> // Must include at least 'osm' key
  name: string
  address?: string
  icon?: string
  iconColor?: string
  presetType?: 'home' | 'work' | 'school'
  userId: string
}

export type CreateCollectionParams = {
  name: string
  description?: string
  icon?: string
  iconColor?: string
  isPublic?: boolean
  isDefault?: boolean
  userId: string
}
