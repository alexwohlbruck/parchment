import Elysia, { t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { makeUserRateLimit } from '../middleware/rate-limit.middleware'
import {
  getOrCreateDeviceWrapSecret,
  rotateAllForUser,
} from '../services/device-wrap-secrets.service'

const wrapSecretReadLimit = makeUserRateLimit({
  name: 'device-wrap-secret-read',
  limit: 60,
  windowMs: 60_000,
})

const rotateLimit = makeUserRateLimit({
  name: 'device-wrap-secret-rotate',
  limit: 10,
  windowMs: 60_000,
})

const app = new Elysia({ prefix: '/users/me' })

app
  .use(requireAuth)
  .use(wrapSecretReadLimit)
  .get(
    '/devices/:deviceId/wrap-secret',
    async ({ user, params }) => {
      const secret = await getOrCreateDeviceWrapSecret(user.id, params.deviceId)
      return { secret }
    },
    {
      params: t.Object({
        deviceId: t.String({
          minLength: 8,
          maxLength: 64,
          pattern: '^[a-zA-Z0-9-]+$',
        }),
      }),
      detail: {
        tags: ['Users', 'Crypto'],
        summary:
          'Get (or lazily create) the per-device wrap secret used by the ' +
          'client to derive the localStorage-seed wrap key. Idempotent.',
      },
    },
  )

app
  .use(requireAuth)
  .use(rotateLimit)
  .post(
    '/device-wrap-secrets/rotate',
    async ({ user }) => {
      await rotateAllForUser(user.id)
      return { ok: true }
    },
    {
      detail: {
        tags: ['Users', 'Crypto'],
        summary:
          'Rotate every device wrap secret for the current user. Any ' +
          'cached seed envelope on any device becomes un-unwrappable.',
      },
    },
  )

export default app
