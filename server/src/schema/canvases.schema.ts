import {
  pgTable,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from './users.schema'
import type { ShareRole } from './shares.schema'
import type { CollectionScheme, ResharingPolicy } from './library.schema'

/**
 * Canvases — user-built maps. A canvas is an ordered stack of layers the user
 * assembled: custom style layers, layers borrowed from their library, and
 * saved place collections drawn as points. Canvases can be toggled onto the
 * main map or opened on their own.
 *
 * Storage mirrors routes and collections exactly:
 *
 *   - `metadataEncrypted` — name / description / icon / colour in a per-canvas
 *     AES envelope (key = HKDF(seed, 'canvas:'+id)). ALWAYS encrypted, both
 *     schemes. The server never sees a canvas's name.
 *
 *   - `scheme` governs the *body* (the layer stack + saved camera):
 *       'server-key' — body stored cleartext in `body`. The server can read
 *         it, which is what makes public links possible.
 *       'user-e2ee'  — body stored in `bodyEncrypted` under the per-canvas
 *         content key. Server is blind; public links are refused.
 *
 * Note what a canvas body does and does not contain: a collection layer holds
 * only the collection's id, never its places. Those stay under the
 * collection's own encryption regardless of which scheme the canvas uses.
 *
 * Multi-user collaboration (sealing the canvas key to collaborators' X25519
 * pubs via ECIES) and a CRDT document format are tracked as follow-ups — see
 * SECURITY.md §canvases and `futureCrdtFormatVersion` below.
 */
export const canvases = pgTable(
  'canvases',
  {
    id: text('id').primaryKey().notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Encryption model picked at creation time. Switching schemes is an
    // explicit re-write of the body, never a silent flip.
    scheme: text('scheme')
      .$type<CollectionScheme>()
      .notNull()
      .default('server-key'),
    resharingPolicy: text('resharing_policy')
      .$type<ResharingPolicy>()
      .notNull()
      .default('owner-only'),

    isPublic: boolean('is_public').notNull().default(false),
    // Public-link share. Only valid for scheme='server-key'.
    publicToken: text('public_token'),
    publicRole: text('public_role').$type<ShareRole>(),

    metadataEncrypted: text('metadata_encrypted'),
    metadataKeyVersion: integer('metadata_key_version').notNull().default(1),

    // ── server-key body (cleartext) ─────────────────────────────────────
    body: jsonb('body'),
    // ── user-e2ee body (encrypted) ──────────────────────────────────────
    bodyEncrypted: text('body_encrypted'),

    // Reserved for a future Yjs / CRDT document format; not in use yet.
    futureCrdtFormatVersion: integer('future_crdt_format_version'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_canvases_user').on(t.userId),
    uniqueIndex('canvases_public_token_uq')
      .on(t.publicToken)
      .where(sql`public_token IS NOT NULL`),
  ],
)

export type Canvas = typeof canvases.$inferSelect
export type NewCanvas = typeof canvases.$inferInsert

// ── Body shape ───────────────────────────────────────────────────────────────
//
// One union rather than a table per layer kind: a canvas body is read and
// written whole, never queried into, and keeping it as a document is what
// lets a future CRDT wrap it without a schema migration.

/** A style layer authored in the layer editor. Sources are inlined. */
export interface CanvasStyleLayer {
  id: string
  kind: 'style'
  name: string
  icon?: string | null
  visible: boolean
  /** A Mapbox / MapLibre layer object with its source inlined. */
  configuration: Record<string, unknown>
  engine?: ('mapbox' | 'maplibre')[]
}

/** A layer borrowed from the user's library, by id. */
export interface CanvasLibraryLayer {
  id: string
  kind: 'library'
  /** A `layers` row id, or a default-template id like `default:hillshade`. */
  layerId: string
  visible: boolean
}

/**
 * A saved place collection, drawn as points. Only the id lives here — the
 * places themselves stay under the collection's own encryption.
 */
export interface CanvasCollectionLayer {
  id: string
  kind: 'collection'
  collectionId: string
  visible: boolean
  /** Overrides for how the collection draws on this canvas. */
  icon?: string | null
  iconColor?: string | null
}

export type CanvasLayer =
  | CanvasStyleLayer
  | CanvasLibraryLayer
  | CanvasCollectionLayer

export interface CanvasBody {
  layers: CanvasLayer[]
  /** The view the canvas opens at. */
  camera?: {
    center: [number, number]
    zoom: number
    bearing?: number
    pitch?: number
  }
}
