import Elysia, { t } from 'elysia'
import { permissions } from '../middleware/auth.middleware'
import { PermissionId } from '../types/auth.types'
import {
  sendFriendInvitation,
  acceptFriendInvitation,
  rejectFriendInvitation,
  cancelFriendInvitation,
  getFriends,
  getInvitations,
  removeFriend,
  syncFriendKeys,
} from '../services/friends.service'
import { resolveHandle } from '../services/federation.service'
import { parseHandle } from '../lib/crypto'
import { i18nPlugin } from '../lib/i18n/plugin'
import { byUser, rateLimitHandler } from '../middleware/rate-limit.middleware'

const app = new Elysia({ prefix: '/friends' }).use(i18nPlugin)

const signedEnvelope = {
  signature: t.String({
    maxLength: 256,
    description: 'Ed25519 signature over the v2 federation envelope',
  }),
  nonce: t.Optional(
    t.String({ maxLength: 64, description: 'Envelope nonce the client signed' }),
  ),
  timestamp: t.Optional(
    t.String({ maxLength: 40, description: 'Envelope timestamp the client signed' }),
  ),
}

function envelopeOf(body: { nonce?: string; timestamp?: string }) {
  return body.nonce && body.timestamp
    ? { nonce: body.nonce, timestamp: body.timestamp }
    : undefined
}

const inviteRateLimit = rateLimitHandler(
  { name: 'friend-invite', limit: 20, windowMs: 60 * 60_000 },
  byUser,
)
const resolveRateLimit = rateLimitHandler(
  { name: 'friend-resolve', limit: 30 },
  byUser,
)

/**
 * Get all friends
 */
app.use(permissions(PermissionId.SOCIAL_READ)).get(
  '/',
  async ({ user }) => {
    const friends = await getFriends(user.id)
    return { friends }
  },
  {
    detail: {
      tags: ['Friends'],
      description: 'Get list of accepted friends',
    },
  },
)

/**
 * Get pending invitations
 */
app.use(permissions(PermissionId.SOCIAL_READ)).get(
  '/invitations',
  async ({ user, query }) => {
    const direction = query.direction as 'incoming' | 'outgoing' | undefined
    const invitations = await getInvitations(user.id, direction)
    return { invitations }
  },
  {
    query: t.Object({
      direction: t.Optional(
        t.Union([t.Literal('incoming'), t.Literal('outgoing')]),
      ),
    }),
    detail: {
      tags: ['Friends'],
      description: 'Get pending friend invitations',
    },
  },
)

/**
 * Send a friend invitation
 */
app.use(permissions(PermissionId.SOCIAL_WRITE)).post(
  '/invite',
  async ({ user, body, status, t }) => {
    const { handle, signature } = body

    // Validate handle format
    if (!parseHandle(handle)) {
      return status(400, { message: t('errors.friends.invalidHandle') })
    }

    const result = await sendFriendInvitation(
      user.id,
      handle,
      signature,
      envelopeOf(body),
    )

    if (!result.success) {
      return status(400, {
        message: result.error || 'Failed to send invitation',
      })
    }

    return { invitation: result.invitation }
  },
  {
    beforeHandle: inviteRateLimit,
    body: t.Object({
      handle: t.String({ maxLength: 320 }),
      ...signedEnvelope,
    }),
    detail: {
      tags: ['Friends'],
      description:
        'Send a friend invitation to a user (local or remote). Remote invitations need the nonce and timestamp the client signed into its v2 FRIEND_INVITE envelope.',
    },
  },
)

/**
 * Accept a friend invitation
 */
app.use(permissions(PermissionId.SOCIAL_WRITE)).post(
  '/invitations/:id/accept',
  async ({ user, params: { id }, body, status }) => {
    const result = await acceptFriendInvitation(
      user.id,
      id,
      body.signature,
      envelopeOf(body),
    )

    if (!result.success) {
      return status(400, {
        message: result.error || 'Failed to accept invitation',
      })
    }

    return { success: true }
  },
  {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object(signedEnvelope),
    detail: {
      tags: ['Friends'],
      description:
        'Accept a pending friend invitation. For a remote sender, the signed v2 FRIEND_ACCEPT envelope is forwarded to their server.',
    },
  },
)

/**
 * Reject a friend invitation
 */
app.use(permissions(PermissionId.SOCIAL_WRITE)).post(
  '/invitations/:id/reject',
  async ({ user, params: { id }, body, status }) => {
    const result = await rejectFriendInvitation(
      user.id,
      id,
      body?.signature,
      body ? envelopeOf(body) : undefined,
    )

    if (!result.success) {
      return status(400, {
        message: result.error || 'Failed to reject invitation',
      })
    }

    return { success: true }
  },
  {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Optional(
      t.Object({
        ...signedEnvelope,
        signature: t.Optional(signedEnvelope.signature),
      }),
    ),
    detail: {
      tags: ['Friends'],
      description:
        'Reject a pending friend invitation. For a remote sender, a signed v2 FRIEND_REJECT envelope is forwarded when provided.',
    },
  },
)

/**
 * Cancel an outgoing invitation
 */
app.use(permissions(PermissionId.SOCIAL_WRITE)).delete(
  '/invitations/:id',
  async ({ user, params: { id }, status }) => {
    const result = await cancelFriendInvitation(user.id, id)

    if (!result.success) {
      return status(400, {
        message: result.error || 'Failed to cancel invitation',
      })
    }

    return { success: true }
  },
  {
    params: t.Object({
      id: t.String(),
    }),
    detail: {
      tags: ['Friends'],
      description: 'Cancel an outgoing friend invitation',
    },
  },
)

/**
 * Remove a friend
 */
app.use(permissions(PermissionId.SOCIAL_WRITE)).delete(
  '/:handle',
  async ({ user, params: { handle }, query, status }) => {
    const decodedHandle = decodeURIComponent(handle)
    const { revoke_signature, revoke_nonce, revoke_timestamp } = query
    const revoke =
      revoke_signature && revoke_nonce && revoke_timestamp
        ? { signature: revoke_signature, nonce: revoke_nonce, timestamp: revoke_timestamp }
        : undefined
    const result = await removeFriend(user.id, decodedHandle, revoke)

    if (!result.success) {
      return status(400, { message: result.error || 'Failed to remove friend' })
    }

    return { success: true }
  },
  {
    params: t.Object({
      handle: t.String(),
    }),
    query: t.Object({
      revoke_signature: t.Optional(t.String({ maxLength: 256 })),
      revoke_nonce: t.Optional(t.String({ maxLength: 64 })),
      revoke_timestamp: t.Optional(t.String({ maxLength: 40 })),
    }),
    detail: {
      tags: ['Friends'],
      description:
        'Remove a friend. For a remote friend, pass the signed v2 RELATIONSHIP_REVOKE envelope; without it, or if delivery fails, the revocation is queued for retry.',
    },
  },
)

/**
 * Resolve a handle to user info
 */
app.use(permissions(PermissionId.SOCIAL_READ)).get(
  '/resolve/:handle',
  async ({ params: { handle }, status, t }) => {
    const decodedHandle = decodeURIComponent(handle)

    if (!parseHandle(decodedHandle)) {
      return status(400, { message: t('errors.friends.invalidHandle') })
    }

    const userInfo = await resolveHandle(decodedHandle)

    if (!userInfo) {
      return status(404, { message: t('errors.notFound.user') })
    }

    const { handle: resolved, signingKey, encryptionKey, inbox, name, picture } = userInfo
    if ([resolved, signingKey, encryptionKey, inbox].some((v) => typeof v !== 'string')) {
      return status(404, { message: t('errors.notFound.user') })
    }
    return {
      handle: resolved,
      signingKey,
      encryptionKey,
      inbox,
      ...(typeof name === 'string' && { name }),
      ...(typeof picture === 'string' && { picture }),
    }
  },
  {
    beforeHandle: resolveRateLimit,
    params: t.Object({
      handle: t.String({ maxLength: 960 }),
    }),
    response: {
      200: t.Object({
        handle: t.String(),
        signingKey: t.String(),
        encryptionKey: t.String(),
        inbox: t.String(),
        name: t.Optional(t.String()),
        picture: t.Optional(t.String()),
      }),
      400: t.Object({ message: t.String() }),
      404: t.Object({ message: t.String() }),
      429: t.Object({ message: t.String() }),
    },
    detail: {
      tags: ['Friends'],
      description: 'Resolve a handle to user info (local or remote)',
    },
  },
)

/**
 * Sync friend keys and profile - refresh public keys and profile info from the server
 * This fixes key drift issues when keys are regenerated and keeps profile info up to date
 */
app.use(permissions(PermissionId.SOCIAL_WRITE)).post(
  '/sync-keys',
  async ({ user }) => {
    const results = await syncFriendKeys(user.id)
    return { results }
  },
  {
    detail: {
      tags: ['Friends'],
      description: 'Sync friend public keys and profile from their servers',
    },
  },
)

export default app
