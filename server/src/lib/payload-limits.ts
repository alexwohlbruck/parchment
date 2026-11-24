import { t } from 'elysia'

/** A key version as stored in a Postgres `integer` column. */
export const KEY_VERSION = t.Integer({ minimum: 1, maximum: 2_147_483_647 })

/** One client-sealed envelope: collection metadata, a point or a share key. */
export const ENVELOPE = t.String({ maxLength: 65_536 })

/** A client-sealed personal blob (settings, history, integration config). */
export const BLOB = t.String({ maxLength: 1_048_576 })

export const NONCE = t.String({ maxLength: 256 })

export const SIGNATURE = t.String({ maxLength: 256 })

export const HANDLE = t.String({ maxLength: 320 })

export const RESOURCE_ID = t.String({ minLength: 1, maxLength: 128 })

/** The most points or share envelopes one rotation or scheme switch carries. */
export const MAX_BATCH = 10_000
