/**
 * Custom user-built routes (client types).
 *
 * Mirrors collections: `scheme` governs body storage; metadata is always
 * E2EE. Decrypted display fields (name/description/icon/iconColor) and the
 * decrypted `body` are populated client-side after fetch and NEVER sent
 * back to the server in cleartext for user-e2ee routes.
 */

export type RouteMode = 'walking' | 'cycling' | 'driving'
export type RouteScheme = 'server-key' | 'user-e2ee'
export type RoutePathMode = 'snap' | 'straight'

/** A point the user dropped, with an optional reverse-geocoded label. */
export interface RouteWaypoint {
  lat: number
  lng: number
  name?: string
}

export interface RouteStats {
  distance: number // meters
  duration: number // seconds
  elevationGain?: number // meters
  elevationLoss?: number // meters
}

/** One routed leg between two consecutive waypoints. */
export interface RouteSegment {
  mode: string
  geometry: Array<[number, number]> // [lng, lat]
  distance: number
  duration: number
}

/**
 * The route's geometric content. Stored cleartext (server-key) or encrypted
 * (user-e2ee). `stats` is embedded so e2ee previews work after decrypt.
 */
export interface RouteBody {
  waypoints: RouteWaypoint[]
  geometry: Array<[number, number]> // [lng, lat] full path
  // Elevation (meters) aligned by index to `geometry`. Present only when the
  // routing engine returned per-vertex elevation. Powers the profile chart.
  elevation?: number[]
  segments?: RouteSegment[]
  pathMode?: RoutePathMode
  stats?: RouteStats
}

export interface Route {
  id: string
  userId: string
  mode: RouteMode
  scheme: RouteScheme
  isPublic: boolean
  publicToken?: string | null
  publicRole?: 'viewer' | null

  metadataEncrypted?: string | null
  metadataKeyVersion?: number

  // Cleartext server-key fields (NULL for e2ee on the wire).
  body?: RouteBody | null
  distance?: number | null
  duration?: number | null
  elevationGain?: number | null
  elevationLoss?: number | null

  // Encrypted e2ee body envelope.
  bodyEncrypted?: string | null
  bodyNonce?: string | null

  createdAt: string
  updatedAt: string

  // ── Client-only decrypted fields (never serialized to server cleartext) ──
  name?: string
  description?: string
  icon?: string
  iconPack?: 'lucide' | 'maki'
  iconColor?: string
}

export interface CreateRouteParams {
  name: string
  description?: string
  icon?: string
  iconColor?: string
  mode: RouteMode
  scheme?: RouteScheme
  isPublic?: boolean
  body: RouteBody
}
