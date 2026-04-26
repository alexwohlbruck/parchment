export interface Bookmark {
  id: string
  externalIds: Record<string, string>
  name: string
  address?: string
  lat: number
  lng: number
  icon: string
  iconPack?: 'lucide' | 'maki'
  iconColor: string
  presetType?: 'home' | 'work' | 'school'
  userId: string
  createdAt: string
  updatedAt: string
}

export type CollectionScheme = 'server-key' | 'user-e2ee'
export type ResharingPolicy = 'owner-only' | 'editors-can-share'
export type ShareRole = 'viewer' | 'editor'

export interface Collection {
  id: string
  userId: string
  isPublic: boolean
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
  iconPack?: 'lucide' | 'maki'
  iconColor?: string

  // Caller's effective role on this collection. `'owner'` on collections the
  // caller owns; a `ShareRole` when the collection is shared TO the caller.
  // The server populates this on accessible fetches (`/:id` and
  // `/shared-with-me`). Clients use it to gate write UI.
  role?: 'owner' | ShareRole

  // When this collection is shared TO the caller, the server includes the
  // ECIES share envelope (encrypted by the sender for the caller) and the
  // sender's federated handle. The client decrypts the envelope to
  // recover the shared metadata (name/icon/…). Absent on owner rows.
  shareEnvelope?: {
    encryptedData: string
    nonce: string
  }
  senderHandle?: string
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
  iconPack?: 'lucide' | 'maki'
  iconColor?: string
  presetType?: 'home' | 'work' | 'school'
}

export interface CreateCollectionParams {
  name: string
  description?: string
  icon?: string
  iconPack?: 'lucide' | 'maki'
  iconColor?: string
  isPublic?: boolean
}
