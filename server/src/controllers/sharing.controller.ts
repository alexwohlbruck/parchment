import Elysia, { t } from 'elysia'
import { requireAuth } from '../middleware/auth.middleware'
import * as sharingService from '../services/sharing.service'

const app = new Elysia({ prefix: '/sharing' })

// ============================================================================
// Outgoing Shares
// ============================================================================

/**
 * Get all outgoing shares
 */
app.use(requireAuth).get(
  '/outgoing',
  async ({ user }) => {
    const shares = await sharingService.getOutgoingShares(user.id)
    return { shares }
  },
  {
    detail: {
      tags: ['Sharing'],
      summary: 'Get all outgoing shares',
    },
  },
)

/**
 * Get shares for a specific resource
 */
app.use(requireAuth).get(
  '/outgoing/:resourceType/:resourceId',
  async ({ params, user }) => {
    const shares = await sharingService.getSharesForResource(
      user.id,
      params.resourceType as any,
      params.resourceId,
    )
    return { shares }
  },
  {
    params: t.Object({
      resourceType: t.String(),
      resourceId: t.String(),
    }),
    detail: {
      tags: ['Sharing'],
      summary: 'Get shares for a resource',
    },
  },
)

/**
 * Create a new share
 */
app.use(requireAuth).post(
  '/',
  async ({ body, user, status }) => {
    const role = body.role ?? 'viewer'

    // For collection shares, enforce that the caller is allowed to share
    // (owner, or editor when resharing_policy permits). Other resource
    // types don't yet have a policy layer — owner check stays implicit
    // in the service.
    if (body.resourceType === 'collection') {
      const { allowed } = await sharingService.canShareCollection(
        user.id,
        body.resourceId,
      )
      if (!allowed) {
        return status(403, { message: 'Not permitted to share this collection' })
      }
    }

    // Cross-server shares MUST carry a signed v2 envelope — without it
    // the remote peer would reject the inbound message. Fail fast so the
    // caller gets a clear error instead of a half-created share row.
    if (!sharingService.isLocalRecipient(body.recipientHandle)) {
      const missing =
        !body.federationSignature ||
        !body.federationNonce ||
        !body.federationTimestamp
      if (missing) {
        return status(400, {
          message:
            'Cross-server shares require federationSignature + federationNonce + federationTimestamp',
        })
      }
    }

    const share = await sharingService.createShare({
      userId: user.id,
      recipientHandle: body.recipientHandle,
      resourceType: body.resourceType as any,
      resourceId: body.resourceId,
      encryptedData: body.encryptedData,
      nonce: body.nonce,
      role,
      federationSignature: body.federationSignature,
      federationNonce: body.federationNonce,
      federationTimestamp: body.federationTimestamp,
    })
    return share
  },
  {
    body: t.Object({
      recipientHandle: t.String(),
      resourceType: t.Union([
        t.Literal('collection'),
        t.Literal('route'),
        t.Literal('map'),
        t.Literal('layer'),
      ]),
      resourceId: t.String(),
      encryptedData: t.Optional(t.String()),
      nonce: t.Optional(t.String()),
      role: t.Optional(
        t.Union([t.Literal('viewer'), t.Literal('editor')]),
      ),
      // v2 federation envelope — required for cross-server recipients. The
      // client builds the canonical envelope, signs it with the sender's
      // Ed25519 private key, and submits all three pieces. Same-server
      // shares may omit them.
      federationSignature: t.Optional(t.String()),
      federationNonce: t.Optional(t.String()),
      federationTimestamp: t.Optional(t.String()),
    }),
    detail: {
      tags: ['Sharing'],
      summary: 'Share a resource with a friend',
    },
  },
)

/**
 * Revoke a share
 */
app.use(requireAuth).post(
  '/:shareId/revoke',
  async ({ params, user, status }) => {
    const revoked = await sharingService.revokeShare(user.id, params.shareId)
    if (!revoked) {
      return status(404, { message: 'Share not found' })
    }
    return { success: true }
  },
  {
    params: t.Object({
      shareId: t.String(),
    }),
    detail: {
      tags: ['Sharing'],
      summary: 'Revoke a share',
    },
  },
)

/**
 * Replace the envelope (encryptedData + nonce) on an existing share.
 * Called by the owner after updating collection metadata so recipients
 * see the new name/icon on their next refetch.
 */
app.use(requireAuth).put(
  '/envelope',
  async ({ body, user, status }) => {
    const updated = await sharingService.updateShareEnvelope(
      user.id,
      body.recipientHandle,
      body.resourceType as any,
      body.resourceId,
      body.encryptedData,
      body.nonce,
    )
    if (!updated) {
      return status(404, { message: 'Share not found' })
    }
    return updated
  },
  {
    body: t.Object({
      recipientHandle: t.String(),
      resourceType: t.Union([
        t.Literal('collection'),
        t.Literal('route'),
        t.Literal('map'),
        t.Literal('layer'),
      ]),
      resourceId: t.String(),
      encryptedData: t.String(),
      nonce: t.String(),
    }),
    detail: {
      tags: ['Sharing'],
      summary: 'Replace an existing share envelope (metadata refresh)',
    },
  },
)

/**
 * Update the role on an existing share (viewer ↔ editor). Preferred over
 * the revoke+recreate pattern since the unique index on the outgoing row
 * would otherwise collide on re-insert.
 */
app.use(requireAuth).patch(
  '/:shareId',
  async ({ params, body, user, status }) => {
    const updated = await sharingService.updateShareRole(
      user.id,
      params.shareId,
      body.role,
    )
    if (!updated) {
      return status(404, { message: 'Share not found' })
    }
    return updated
  },
  {
    params: t.Object({
      shareId: t.String(),
    }),
    body: t.Object({
      role: t.Union([t.Literal('viewer'), t.Literal('editor')]),
    }),
    detail: {
      tags: ['Sharing'],
      summary: "Update an existing share's role",
    },
  },
)

/**
 * Delete a share
 */
app.use(requireAuth).delete(
  '/:shareId',
  async ({ params, user, status }) => {
    const deleted = await sharingService.deleteShare(user.id, params.shareId)
    if (!deleted) {
      return status(404, { message: 'Share not found' })
    }
    return { success: true }
  },
  {
    params: t.Object({
      shareId: t.String(),
    }),
    detail: {
      tags: ['Sharing'],
      summary: 'Delete a share',
    },
  },
)

// ============================================================================
// Incoming Shares
// ============================================================================

/**
 * Get all incoming shares
 */
app.use(requireAuth).get(
  '/incoming',
  async ({ user }) => {
    const shares = await sharingService.getIncomingShares(user.id)
    return { shares }
  },
  {
    detail: {
      tags: ['Sharing'],
      summary: 'Get all incoming shares',
    },
  },
)

/**
 * Get pending incoming shares
 */
app.use(requireAuth).get(
  '/incoming/pending',
  async ({ user }) => {
    const shares = await sharingService.getPendingIncomingShares(user.id)
    return { shares }
  },
  {
    detail: {
      tags: ['Sharing'],
      summary: 'Get pending incoming shares',
    },
  },
)

/**
 * Accept an incoming share
 */
app.use(requireAuth).post(
  '/incoming/:shareId/accept',
  async ({ params, user, status }) => {
    const share = await sharingService.acceptIncomingShare(
      user.id,
      params.shareId,
    )
    if (!share) {
      return status(404, { message: 'Share not found' })
    }
    return share
  },
  {
    params: t.Object({
      shareId: t.String(),
    }),
    detail: {
      tags: ['Sharing'],
      summary: 'Accept an incoming share',
    },
  },
)

/**
 * Reject an incoming share
 */
app.use(requireAuth).post(
  '/incoming/:shareId/reject',
  async ({ params, user, status }) => {
    const rejected = await sharingService.rejectIncomingShare(
      user.id,
      params.shareId,
    )
    if (!rejected) {
      return status(404, { message: 'Share not found' })
    }
    return { success: true }
  },
  {
    params: t.Object({
      shareId: t.String(),
    }),
    detail: {
      tags: ['Sharing'],
      summary: 'Reject an incoming share',
    },
  },
)

/**
 * Delete an incoming share
 */
app.use(requireAuth).delete(
  '/incoming/:shareId',
  async ({ params, user, status }) => {
    const deleted = await sharingService.deleteIncomingShare(
      user.id,
      params.shareId,
    )
    if (!deleted) {
      return status(404, { message: 'Share not found' })
    }
    return { success: true }
  },
  {
    params: t.Object({
      shareId: t.String(),
    }),
    detail: {
      tags: ['Sharing'],
      summary: 'Delete an incoming share',
    },
  },
)

export default app


