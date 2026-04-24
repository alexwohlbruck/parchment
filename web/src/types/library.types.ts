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

export type CollectionScheme = 'server-key' | 'user-e2ee'
export type ResharingPolicy = 'owner-only' | 'editors-can-share'

export interface Collection {
  id: string
  userId: string
  isPublic: boolean
  isDefault?: boolean
  // Deprecated: use `scheme` instead. Kept on the type so legacy code
  // that reads it compiles; removing it is a follow-up once all
  // client code migrates.
  isSensitive?: boolean
  // Encryption scheme of the collection. Determines whether bookmarks
  // live in the cleartext `bookmarks` table or in `encrypted_points`,
  // and whether public-link shares are allowed.
  scheme: CollectionScheme
  // Who (besides the owner) can issue shares on this collection.
  resharingPolicy: ResharingPolicy
  // Set when a public-link share exists. Only present for server-key
  // collections; user-e2ee collections can never have a public link.
  publicToken?: string | null
  publicRole?: 'viewer' | null
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
