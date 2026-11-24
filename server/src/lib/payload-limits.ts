import { t } from 'elysia'

/** A key version as stored in a Postgres `integer` column. */
export const KEY_VERSION = t.Integer({ minimum: 1, maximum: 2_147_483_647 })
