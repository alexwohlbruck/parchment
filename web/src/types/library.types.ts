export interface Bookmark {
  id: string
  externalIds: Record<string, string>
  name: string
  address?: string
  lat: number
  lng: number
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

export interface BookmarkCollection {
  bookmarkId: string
  collectionId: string
  addedAt: string
}

export interface BookmarkWithDetails {
  bookmark: Bookmark
  details: any
}

export interface CreateBookmarkParams {
  externalIds: Record<string, string>
  name: string
  address?: string
  lat: number
  lng: number
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
