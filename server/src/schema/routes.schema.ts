import {
  pgTable,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  doublePrecision,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from './users.schema'
import type { ShareRole } from './shares.schema'
import type { CollectionScheme, ResharingPolicy } from './library.schema'

/**
 * Custom user-built routes (Apple-Maps-style "Create a Custom Route").
 *
 * The user drops waypoints; the routing engine snaps a path between them;
 * the result is saved with a name + description for later use (turn it into
 * directions, share, or — eventually — guided navigation).
 *
 * Storage model mirrors `collections` one-for-one:
 *
 *   - `metadataEncrypted` — name / description / icon / iconColor live in a
 *     per-route AES envelope (key = HKDF(seed, 'route:'+id)). ALWAYS
 *     encrypted, both schemes. The server never sees the plaintext name.
 *
 *   - `scheme` governs the *body* (waypoints + routed geometry + stats):
 *       'server-key' — body stored cleartext in `body` + the cleartext
 *         `distance` / `duration` / `elevation*` columns. Server can read it,
 *         so it powers list previews, sorting, and public-link sharing.
 *       'user-e2ee'  — body stored in `bodyEncrypted` + `bodyNonce` under
 *         the per-route content key. Server is blind; public links disallowed
 *         and the cleartext stat columns stay NULL.
 *
 * `mode`, `isPublic`, `scheme` stay cleartext because the client needs them
 * for list icons/filtering and the server needs them for access control —
 * exactly the same low-sensitivity leak collections already accept.
 */
export const routes = pgTable(
  'routes',
  {
    id: text('id').primaryKey().notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Travel profile the path was snapped for. Drives the list icon and is
    // the default mode when the route is turned into directions.
    mode: text('mode')
      .$type<'walking' | 'cycling' | 'driving'>()
      .notNull()
      .default('walking'),

    // Encryption scheme — see file header. Shared with collections.
    scheme: text('scheme')
      .$type<CollectionScheme>()
      .notNull()
      .default('server-key'),
    resharingPolicy: text('resharing_policy')
      .$type<ResharingPolicy>()
      .notNull()
      .default('owner-only'),

    isPublic: boolean('is_public').default(false).notNull(),
    // Public-link share. Only valid for scheme='server-key' (server must be
    // able to read the body to render the shared view). Random base64url.
    publicToken: text('public_token'),
    publicRole: text('public_role').$type<ShareRole>(),

    // Always-encrypted display metadata (name / description / icon / color).
    metadataEncrypted: text('metadata_encrypted'),
    metadataKeyVersion: integer('metadata_key_version').notNull().default(1),

    // ── server-key body (cleartext) ─────────────────────────────────────
    // { waypoints: [{lat,lng,name?}], geometry: [[lng,lat], …],
    //   segments?: [...], pathMode } — null for user-e2ee routes.
    body: jsonb('body'),
    // Cleartext stats for previews / sorting (server-key only; NULL for
    // e2ee — the client renders those from the decrypted body instead).
    distance: doublePrecision('distance'),
    duration: doublePrecision('duration'),
    elevationGain: doublePrecision('elevation_gain'),
    elevationLoss: doublePrecision('elevation_loss'),

    // ── user-e2ee body (encrypted) ──────────────────────────────────────
    bodyEncrypted: text('body_encrypted'),
    bodyNonce: text('body_nonce'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_routes_user').on(t.userId),
    // Partial unique — only enforce when a token is set, like collections.
    uniqueIndex('routes_public_token_uq')
      .on(t.publicToken)
      .where(sql`public_token IS NOT NULL`),
  ],
)

export type Route = typeof routes.$inferSelect
export type NewRoute = typeof routes.$inferInsert

/** Cleartext server-key body shape (also the decrypted shape for e2ee). */
export interface RouteBody {
  waypoints: Array<{ lat: number; lng: number; name?: string }>
  // Routed path as [lng, lat] pairs (GeoJSON order).
  geometry: Array<[number, number]>
  // Per-leg routed segments, kept so the editor can re-open and re-route
  // individual legs without replanning the whole path.
  segments?: Array<{
    mode: string
    geometry: Array<[number, number]>
    distance: number
    duration: number
  }>
  pathMode?: 'snap' | 'straight'
  // Stats embedded so the client can render previews for e2ee routes where
  // the cleartext stat columns are NULL.
  stats?: {
    distance: number
    duration: number
    elevationGain?: number
    elevationLoss?: number
  }
}
