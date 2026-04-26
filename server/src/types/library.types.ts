import {
  bookmarks,
  collections,
  bookmarksCollections,
} from '../schema/library.schema'

// For API responses, we want to expose lat/lng instead of raw geometry
export type Bookmark = Omit<typeof bookmarks.$inferSelect, 'geometry'> & {
  lat: number
  lng: number
}

export type NewBookmark = typeof bookmarks.$inferInsert
export type Collection = typeof collections.$inferSelect
export type NewCollection = typeof collections.$inferInsert
export type BookmarkCollection = typeof bookmarksCollections.$inferSelect
export type NewBookmarkCollection = typeof bookmarksCollections.$inferInsert

export type CreateBookmarkParams = {
  externalIds: Record<string, string> // Must include at least 'osm' key
  name: string
  address?: string
  lat: number
  lng: number
  icon?: string
  iconPack?: 'lucide' | 'maki'
  iconColor?: string
  presetType?: 'home' | 'work' | 'school'
  userId: string
}

export type CreateCollectionParams = {
  metadataEncrypted?: string
  metadataKeyVersion?: number
  isPublic?: boolean
  userId: string
}
