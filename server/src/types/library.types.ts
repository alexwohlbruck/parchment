import {
  savedPlaces,
  collections,
  placesCollections,
} from '../schema/library.schema'

export type SavedPlace = typeof savedPlaces.$inferSelect
export type NewSavedPlace = typeof savedPlaces.$inferInsert
export type Collection = typeof collections.$inferSelect
export type NewCollection = typeof collections.$inferInsert
export type PlaceCollection = typeof placesCollections.$inferSelect
export type NewPlaceCollection = typeof placesCollections.$inferInsert

// Helper type to enforce required fields when creating saved places
export type CreateSavedPlaceParams = {
  externalIds: Record<string, string> // Must include at least 'osm' key
  name: string
  address?: string
  icon?: string
  iconColor?: string
  presetType?: 'home' | 'work' | 'school'
  userId: string
}

// Helper type to enforce required fields when creating collections
export type CreateCollectionParams = {
  name: string
  description?: string
  icon?: string
  iconColor?: string
  isPublic?: boolean
  userId: string
}
