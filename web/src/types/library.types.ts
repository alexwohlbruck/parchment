import { Icon } from './app.types'

export interface SavedPlace {
  id: string
  externalIds: Record<string, string>
  name: string
  address?: string
  icon: string
  iconColor: string
  presetType?: 'home' | 'work' | 'school'
  userId: string
  createdAt: string
  updatedAt: string
}

export interface Collection {
  id: string
  name: string
  description?: string
  icon: string
  iconColor: string
  userId: string
  isPublic: boolean
  isDefault?: boolean
  createdAt: string
  updatedAt: string
}

export interface PlaceCollection {
  placeId: string
  collectionId: string
  addedAt: string
}

export interface SavedPlaceWithDetails {
  savedPlace: SavedPlace
  details: any // UnifiedPlace from the place service
}

export interface CreateSavedPlaceParams {
  externalIds: Record<string, string>
  name: string
  address?: string
  icon?: string
  iconColor?: string
  presetType?: 'home' | 'work' | 'school'
}

export interface CreateCollectionParams {
  name: string
  description?: string
  icon?: string
  iconColor?: string
  isPublic?: boolean
}
