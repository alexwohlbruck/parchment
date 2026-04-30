import Elysia, { t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import { makeUserRateLimit } from '../middleware/rate-limit.middleware'
import { isFriend } from '../services/friends.service'
import * as locationE2eeService from '../services/location-e2ee.service'

const app = new Elysia({ prefix: '/location' })

// Rate-limit the broadcast endpoint. Movement-driven gating in the
// client (2s floor, 3m distance threshold, 5min stationary refresh)
// caps a well-behaved client to ~30 req/min while moving. 60/min leaves
// headroom for burst broadcasts (sharing toggle, refresh-and-broadcast)
// without throttling real usage. Anything above is either a bug or abuse.
const updateRateLimit = makeUserRateLimit({
  name: 'location-update',
  limit: 60,
  windowMs: 60_000,
})

// ============================================================================
// Location Sharing Configuration
// ============================================================================

/**
 * Get location sharing config for all friends
 */
app.use(requireAuth).get(
  '/e2ee/config',
  async ({ user, status }) => {
    if (!user) {
      return status(401, { message: t('errors.auth.authenticationRequired') })
    }

    const configs = await locationE2eeService.getLocationSharingConfigs(user.id)
    return { configs }
  },
  {
    detail: {
      tags: ['Location'],
      summary: 'Get location sharing configuration for all friends',
    },
  },
)

/**
 * Set location sharing config for a friend
 */
app.use(requireAuth).post(
  '/e2ee/config',
  async ({ body, user, status }) => {
    if (!user) {
      return status(401, { message: t('errors.auth.authenticationRequired') })
    }

    const config = await locationE2eeService.setLocationSharingConfig(
      user.id,
      body.friendHandle.toLowerCase(),
      { enabled: body.enabled },
    )

    return { config }
  },
  {
    body: t.Object({
      friendHandle: t.String(),
      enabled: t.Optional(t.Boolean()),
    }),
    detail: {
      tags: ['Location'],
      summary: 'Set location sharing configuration for a friend',
    },
  },
)

/**
 * Disable location sharing with a friend
 */
app.use(requireAuth).delete(
  '/e2ee/config/:friendHandle',
  async ({ params, user, status }) => {
    if (!user) {
      return status(401, { message: t('errors.auth.authenticationRequired') })
    }

    const deleted = await locationE2eeService.disableLocationSharing(
      user.id,
      decodeURIComponent(params.friendHandle).toLowerCase(),
    )

    return { deleted }
  },
  {
    params: t.Object({
      friendHandle: t.String(),
    }),
    detail: {
      tags: ['Location'],
      summary: 'Disable location sharing with a friend',
    },
  },
)

// ============================================================================
// Location Updates (Broadcasting)
// ============================================================================

/**
 * Broadcast encrypted location to friends.
 *
 * Each item is processed independently — one bad item (not a friend,
 * sharing disabled, replay) doesn't fail the whole batch. The response
 * mirrors that with per-item status/reason.
 *
 * Authorization model: a row is stored ONLY when (a) `forFriendHandle`
 * is an accepted friend of the caller AND (b) the caller has explicitly
 * enabled sharing with that friend (`locationSharingConfig.enabled =
 * true`). This is the only authorization gate; without it an
 * authenticated user could fan ciphertext rows out to any handle and
 * use realtime delivery as a presence/fingerprint oracle.
 */
app
  .use(requireAuth)
  .use(updateRateLimit)
  .post(
    '/e2ee/update',
    async ({ body, user, status }) => {
      if (!user) {
        return status(401, { message: t('errors.auth.authenticationRequired') })
      }

      const results = await Promise.all(
        body.locations.map(async (item) => {
          const friendHandle = item.forFriendHandle.toLowerCase()
          try {
            if (!(await isFriend(user.id, friendHandle))) {
              return { friendHandle, stored: false, reason: 'not-a-friend' as const }
            }

            const config =
              await locationE2eeService.getLocationSharingConfigForFriend(
                user.id,
                friendHandle,
              )
            if (!config?.enabled) {
              return { friendHandle, stored: false, reason: 'not-enabled' as const }
            }

            const result = await locationE2eeService.storeEncryptedLocation(
              user.id,
              friendHandle,
              item.encryptedLocation,
              item.nonce,
            )
            if (!result.stored) {
              return { friendHandle, stored: false, reason: 'replayed' as const }
            }
            return { friendHandle, stored: true as const }
          } catch (err) {
            return { friendHandle, stored: false, reason: 'error' as const }
          }
        }),
      )

      return { results }
    },
    {
      body: t.Object({
        locations: t.Array(
          t.Object({
            forFriendHandle: t.String(),
            encryptedLocation: t.String(),
            nonce: t.String(),
          }),
        ),
      }),
      detail: {
        tags: ['Location'],
        summary: 'Broadcast encrypted location to friends',
      },
    },
  )

/**
 * Get encrypted locations from friends
 */
app.use(requireAuth).get(
  '/e2ee/friends',
  async ({ user, status }) => {
    if (!user) {
      return status(401, { message: t('errors.auth.authenticationRequired') })
    }

    const locations =
      await locationE2eeService.getEncryptedLocationsFromFriends(user.id)

    return {
      locations: locations.map((l) => ({
        id: l.id,
        fromUserId: l.userId,
        senderHandle: l.senderHandle,
        encryptedLocation: l.encryptedLocation,
        nonce: l.nonce,
        updatedAt: l.updatedAt.toISOString(),
      })),
    }
  },
  {
    detail: {
      tags: ['Location'],
      summary: 'Get encrypted locations from friends',
    },
  },
)

export default app
