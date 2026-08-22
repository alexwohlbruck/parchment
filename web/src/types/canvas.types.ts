/**
 * Canvases — user-built maps (client types).
 *
 * Mirrors routes and collections: `scheme` governs how the body is stored;
 * metadata (name / description / icon / colour) is always E2EE. Decrypted
 * display fields and the decrypted `body` are populated client-side after
 * fetch and are never sent back in cleartext for a user-e2ee canvas.
 *
 * A canvas is an ordered stack of layers, drawn bottom-first. Three kinds
 * cover what a canvas can hold today; the union is the extension point for
 * drawings, routes and file uploads later.
 */

import type { MapEngine } from '@/types/map.types'

export type CanvasScheme = 'server-key' | 'user-e2ee'

/** A style layer authored in the layer editor. Its source is inlined. */
export interface CanvasStyleLayer {
  id: string
  kind: 'style'
  name: string
  icon?: string | null
  visible: boolean
  configuration: Record<string, unknown>
  engine?: MapEngine[]
}

/** A layer borrowed from the user's library, by id. */
export interface CanvasLibraryLayer {
  id: string
  kind: 'library'
  /** A user layer's id, or a default-template id like `default:hillshade`. */
  layerId: string
  visible: boolean
}

/**
 * A saved place collection drawn as points. Only the collection id lives on
 * the canvas — the places stay under the collection's own encryption, so a
 * server-key canvas never leaks an e2ee collection's contents.
 */
export interface CanvasCollectionLayer {
  id: string
  kind: 'collection'
  collectionId: string
  visible: boolean
  icon?: string | null
  iconColor?: string | null
}

export type CanvasLayer =
  | CanvasStyleLayer
  | CanvasLibraryLayer
  | CanvasCollectionLayer

export type CanvasLayerKind = CanvasLayer['kind']

export interface CanvasCamera {
  center: [number, number]
  zoom: number
  bearing?: number
  pitch?: number
}

export interface CanvasBody {
  layers: CanvasLayer[]
  camera?: CanvasCamera
}

export interface Canvas {
  id: string
  userId: string
  scheme: CanvasScheme
  isPublic: boolean
  publicToken?: string | null
  publicRole?: 'viewer' | null

  metadataEncrypted?: string | null
  metadataKeyVersion?: number

  /** Cleartext server-key body (null on the wire for e2ee canvases). */
  body?: CanvasBody | null
  /** Encrypted e2ee body envelope. */
  bodyEncrypted?: string | null

  createdAt: string
  updatedAt: string

  // ── Decrypted client-side, never sent back ────────────────────────────
  name?: string
  description?: string
  icon?: string | null
  iconPack?: 'lucide' | 'maki'
  iconColor?: string | null
  /**
   * True when the metadata envelope wouldn't open — a canvas from another
   * device before the seed synced, say. Renders with a placeholder title
   * rather than disappearing.
   */
  undecryptable?: boolean
}

export interface CreateCanvasParams {
  name: string
  description?: string
  icon?: string
  iconColor?: string
  scheme?: CanvasScheme
}

/** An empty body, so callers never have to null-check the layer list. */
export function emptyCanvasBody(): CanvasBody {
  return { layers: [] }
}

/**
 * A detached copy of a canvas body, for the editor to mutate freely.
 *
 * JSON rather than `structuredClone`: bodies come out of a Pinia store, so
 * they arrive as Vue reactive proxies, and `structuredClone` refuses those
 * outright (DataCloneError). A body is plain JSON by construction — it has to
 * be, it round-trips through the API — so this loses nothing.
 */
export function cloneCanvasBody(body: CanvasBody | null | undefined): CanvasBody {
  if (!body) return emptyCanvasBody()
  return JSON.parse(JSON.stringify(body)) as CanvasBody
}
