import Elysia, { t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import * as locationE2eeService from '../services/location-e2ee.service'

const app = new Elysia({ prefix: '/location' })

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
      body.friendHandle,
      {
        enabled: body.enabled,
        refreshInterval: body.refreshInterval,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      },
    )

    return { config }
  },
  {
    body: t.Object({
      friendHandle: t.String(),
      enabled: t.Optional(t.Boolean()),
      refreshInterval: t.Optional(t.Number()),
      expiresAt: t.Optional(t.String()),
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
      decodeURIComponent(params.friendHandle),
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
 * Update location: broadcast encrypted location to friends
 */
app.use(requireAuth).post(
  '/e2ee/update',
  async ({ body, user, status }) => {
    if (!user) {
      return status(401, { message: t('errors.auth.authenticationRequired') })
    }

    const results = []

    for (const item of body.locations) {
      await locationE2eeService.storeEncryptedLocation(
        user.id,
        item.forFriendHandle,
        item.encryptedLocation,
        item.nonce,
      )
      results.push({ friendHandle: item.forFriendHandle, stored: true })
    }

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
