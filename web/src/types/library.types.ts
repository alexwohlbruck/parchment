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
  userId: string
  isPublic: boolean
  isDefault?: boolean
  createdAt: string
  updatedAt: string

  // Opaque encrypted metadata envelope as returned by the server.
  metadataEncrypted?: string | null
  metadataKeyVersion?: number

  // Decrypted metadata fields. Populated client-side after fetch by
  // the collections service; NEVER sent back to the server in cleartext.
  // Use `collection.name` / `.description` / etc. for display.
  name?: string
  description?: string
  icon?: string
  iconColor?: string
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
