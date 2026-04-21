import Elysia, { t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
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

const app = new Elysia({ prefix: '/friends' })

/**
 * Get all friends
 */
app.use(requireAuth).get(
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
app.use(requireAuth).get(
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
app.use(requireAuth).post(
  '/invite',
  async ({ user, body, status, t }) => {
    const { handle, signature } = body

    // Validate handle format
    if (!parseHandle(handle)) {
      return status(400, { message: t('errors.friends.invalidHandle') })
    }

    const result = await sendFriendInvitation(user.id, handle, signature)

    if (!result.success) {
      return status(400, {
        message: result.error || 'Failed to send invitation',
      })
    }

    return { invitation: result.invitation }
  },
  {
    body: t.Object({
      handle: t.String(),
      signature: t.String(),
    }),
    detail: {
      tags: ['Friends'],
      description: 'Send a friend invitation to a user (local or remote)',
    },
  },
)

/**
 * Accept a friend invitation
 */
app.use(requireAuth).post(
  '/invitations/:id/accept',
  async ({ user, params: { id }, body, status, t }) => {
    const result = await acceptFriendInvitation(user.id, id, body.signature)

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
    body: t.Object({
      signature: t.String(),
    }),
    detail: {
      tags: ['Friends'],
      description: 'Accept a pending friend invitation',
    },
  },
)

/**
 * Reject a friend invitation
 */
app.use(requireAuth).post(
  '/invitations/:id/reject',
  async ({ user, params: { id }, body, status, t }) => {
    const result = await rejectFriendInvitation(user.id, id, body?.signature)

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
        signature: t.Optional(t.String()),
      }),
    ),
    detail: {
      tags: ['Friends'],
      description: 'Reject a pending friend invitation',
    },
  },
)

/**
 * Cancel an outgoing invitation
 */
app.use(requireAuth).delete(
  '/invitations/:id',
  async ({ user, params: { id }, status, t }) => {
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
app.use(requireAuth).delete(
  '/:handle',
  async ({ user, params: { handle }, query, status }) => {
    const decodedHandle = decodeURIComponent(handle)
    const revokeSignature = query?.revoke_signature as string | undefined
    const result = await removeFriend(user.id, decodedHandle, revokeSignature)

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
      revoke_signature: t.Optional(t.String()),
    }),
    detail: {
      tags: ['Friends'],
      description: 'Remove a friend',
    },
  },
)

/**
 * Resolve a handle to user info
 */
app.use(requireAuth).get(
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

    return userInfo
  },
  {
    params: t.Object({
      handle: t.String(),
    }),
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
app.use(requireAuth).post(
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
