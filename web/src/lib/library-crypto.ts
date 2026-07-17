/**
 * Collection + canvas metadata encryption (Part C.5c).
 *
 * Each collection / canvas has its own AES key, derived deterministically
 * from the user's seed + entity id via HKDF. Metadata (name, description,
 * icon, color, …) rides in a v2 envelope. AAD binds user + entity so
 * metadata cross-swap fails AEAD.
 *
 * Deferred (tracked as follow-up):
 * - Multi-user canvas collaboration: ECIES-seal the canvas key to each
 *   collaborator's long-term X25519 pub. Revocation = rotate key + reseal.
 * - Dropping legacy cleartext columns on `collections` once all read-paths
 *   use the encrypted envelope.
 * - Yjs CRDT document-level encryption when collab lands
 *   (see library.schema.ts `futureCrdtFormatVersion` field).
 */

import {
  encryptEnvelopeString,
  decryptEnvelopeString,
  type AAD,
} from './crypto-envelope'
import { deriveCollectionKey } from './federation-crypto'

const COLLECTION_CONTEXT = 'parchment-collection-metadata-v1'
const CANVAS_CONTEXT = 'parchment-canvas-metadata-v1'
const ROUTE_METADATA_CONTEXT = 'parchment-route-metadata-v1'
const ROUTE_BODY_CONTEXT = 'parchment-route-body-v1'

export interface CollectionMetadata {
  name?: string
  description?: string
  icon?: string
  /**
   * Which icon pack `icon` is drawn from. Defaults to lucide when absent
   * so existing collections (which never carried this field) keep
   * rendering correctly.
   */
  iconPack?: 'lucide' | 'maki'
  iconColor?: string
  isPublic?: boolean
}

export interface CanvasMetadata {
  name?: string
  description?: string
  // Canvas rendering hints / style tokens live here; shape is intentionally
  // loose so future canvas features can extend without a schema migration.
  style?: Record<string, unknown>
}

function collectionAAD(params: {
  userId: string
  collectionId: string
}): AAD {
  return {
    userId: params.userId,
    recordType: 'collection-metadata',
    recordId: params.collectionId,
    keyContext: COLLECTION_CONTEXT,
  }
}

function canvasAAD(params: { userId: string; canvasId: string }): AAD {
  return {
    userId: params.userId,
    recordType: 'canvas-metadata',
    recordId: params.canvasId,
    keyContext: CANVAS_CONTEXT,
  }
}

export function encryptCollectionMetadata(params: {
  metadata: CollectionMetadata
  seed: Uint8Array
  userId: string
  collectionId: string
}): string {
  const key = deriveCollectionKey(params.seed, params.collectionId)
  return encryptEnvelopeString({
    plaintext: JSON.stringify(params.metadata),
    key,
    aad: collectionAAD({
      userId: params.userId,
      collectionId: params.collectionId,
    }),
  })
}

export function decryptCollectionMetadata(params: {
  envelope: string
  seed: Uint8Array
  userId: string
  collectionId: string
}): CollectionMetadata {
  const key = deriveCollectionKey(params.seed, params.collectionId)
  const plaintext = decryptEnvelopeString({
    envelope: params.envelope,
    key,
    aad: collectionAAD({
      userId: params.userId,
      collectionId: params.collectionId,
    }),
  })
  return JSON.parse(plaintext) as CollectionMetadata
}

export function encryptCanvasMetadata(params: {
  metadata: CanvasMetadata
  seed: Uint8Array
  userId: string
  canvasId: string
}): string {
  // Canvases get their own key derivation so a collection key can't decrypt
  // a canvas and vice versa — belt + suspenders on top of AAD binding.
  const key = deriveCollectionKey(params.seed, `canvas:${params.canvasId}`)
  return encryptEnvelopeString({
    plaintext: JSON.stringify(params.metadata),
    key,
    aad: canvasAAD({
      userId: params.userId,
      canvasId: params.canvasId,
    }),
  })
}

export function decryptCanvasMetadata(params: {
  envelope: string
  seed: Uint8Array
  userId: string
  canvasId: string
}): CanvasMetadata {
  const key = deriveCollectionKey(params.seed, `canvas:${params.canvasId}`)
  const plaintext = decryptEnvelopeString({
    envelope: params.envelope,
    key,
    aad: canvasAAD({
      userId: params.userId,
      canvasId: params.canvasId,
    }),
  })
  return JSON.parse(plaintext) as CanvasMetadata
}

// ── Custom routes ─────────────────────────────────────────────────────────
//
// Routes mirror collections: display metadata is ALWAYS encrypted; the body
// (waypoints + geometry + stats) is cleartext for server-key routes and
// encrypted for user-e2ee routes. Two separate key derivations + AADs keep a
// route key from decrypting a collection (and a route's metadata key from
// decrypting its body) — belt + suspenders on top of the AAD binding.

export interface RouteMetadata {
  name?: string
  description?: string
  icon?: string
  iconPack?: 'lucide' | 'maki'
  iconColor?: string
}

function routeMetadataAAD(params: { userId: string; routeId: string }): AAD {
  return {
    userId: params.userId,
    recordType: 'route-metadata',
    recordId: params.routeId,
    keyContext: ROUTE_METADATA_CONTEXT,
  }
}

function routeBodyAAD(params: { userId: string; routeId: string }): AAD {
  return {
    userId: params.userId,
    recordType: 'route-body',
    recordId: params.routeId,
    keyContext: ROUTE_BODY_CONTEXT,
  }
}

export function encryptRouteMetadata(params: {
  metadata: RouteMetadata
  seed: Uint8Array
  userId: string
  routeId: string
}): string {
  const key = deriveCollectionKey(params.seed, `route:${params.routeId}`)
  return encryptEnvelopeString({
    plaintext: JSON.stringify(params.metadata),
    key,
    aad: routeMetadataAAD({ userId: params.userId, routeId: params.routeId }),
  })
}

export function decryptRouteMetadata(params: {
  envelope: string
  seed: Uint8Array
  userId: string
  routeId: string
}): RouteMetadata {
  const key = deriveCollectionKey(params.seed, `route:${params.routeId}`)
  const plaintext = decryptEnvelopeString({
    envelope: params.envelope,
    key,
    aad: routeMetadataAAD({ userId: params.userId, routeId: params.routeId }),
  })
  return JSON.parse(plaintext) as RouteMetadata
}

/** Encrypt a route body (user-e2ee routes only). Returns the envelope string. */
export function encryptRouteBody(params: {
  body: unknown
  seed: Uint8Array
  userId: string
  routeId: string
}): string {
  const key = deriveCollectionKey(params.seed, `route-body:${params.routeId}`)
  return encryptEnvelopeString({
    plaintext: JSON.stringify(params.body),
    key,
    aad: routeBodyAAD({ userId: params.userId, routeId: params.routeId }),
  })
}

export function decryptRouteBody<T = unknown>(params: {
  envelope: string
  seed: Uint8Array
  userId: string
  routeId: string
}): T {
  const key = deriveCollectionKey(params.seed, `route-body:${params.routeId}`)
  const plaintext = decryptEnvelopeString({
    envelope: params.envelope,
    key,
    aad: routeBodyAAD({ userId: params.userId, routeId: params.routeId }),
  })
  return JSON.parse(plaintext) as T
}
