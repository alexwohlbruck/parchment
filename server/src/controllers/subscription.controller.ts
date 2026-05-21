import Elysia, { t } from 'elysia'
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks'
import { requireAuth } from '../middleware/auth.middleware'
import { billing } from '../config'
import { fetchUser } from '../services/user.service'
import {
  createCheckoutSession,
  getCustomerPortalUrl,
  getSubscriptionStatus,
  getSubscriptionDetails,
  getProductsInfo,
  verifyAndSyncSubscription,
  assignTierRole,
  removeTierRole,
  resolveProductTier,
  linkPolarCustomer,
  findUserByPolarCustomerId,
} from '../services/subscription.service'
import { logger } from '../lib/logger'
import { publish } from '../services/realtime/event-bus.service'

const app = new Elysia({ prefix: '/subscriptions' })

app.get(
  '/config',
  async () => {
    const products = billing.enabled ? await getProductsInfo() : null
    return { billingEnabled: billing.enabled, products }
  },
  {
    detail: {
      tags: ['Subscriptions'],
      summary: 'Get billing configuration and product info',
    },
  },
)

if (billing.enabled) {
  // Webhook is unauthenticated — lives on the main app instance.
  // Authenticated routes use a separate Elysia instance below.
  app.post(
    '/webhook',
    async ({ body, request, status }) => {
      const rawBody = body as string
      const headers: Record<string, string> = {}
      request.headers.forEach((value, key) => {
        headers[key] = value
      })

      let event: { type: string; data: Record<string, unknown> }
      try {
        event = validateEvent(rawBody, headers, billing.webhookSecret) as typeof event
      } catch (err) {
        if (err instanceof WebhookVerificationError) {
          logger.warn('Webhook signature verification failed')
          return status(400, { message: 'Invalid webhook signature' })
        }
        logger.warn({ errorName: (err as Error).name }, 'Webhook event validation failed')
        return status(400, { message: 'Invalid webhook payload' })
      }

      const { type, data } = event

      switch (type) {
        case 'subscription.active': {
          const polarCustomerId = data.customerId as string
          const productId = data.productId as string | undefined
          const metadataUserId = data.metadata?.parchmentUserId as
            | string
            | undefined

          const linkedUser = await findUserByPolarCustomerId(polarCustomerId)
          let userId = linkedUser?.id ?? metadataUserId

          if (linkedUser && metadataUserId && linkedUser.id !== metadataUserId) {
            logger.warn(
              { polarCustomerId, linkedUserId: linkedUser.id, metadataUserId },
              'Webhook: metadata userId conflicts with linked user — using linked user',
            )
            userId = linkedUser.id
          }

          if (!userId) {
            logger.warn(
              { polarCustomerId },
              'Webhook: no user found for subscription activation',
            )
            return status(200, { received: true })
          }

          await linkPolarCustomer(userId, polarCustomerId)

          const tier = productId ? resolveProductTier(productId) : null
          if (tier && tier !== 'free') {
            await assignTierRole(userId, tier)
          } else {
            // Fallback: unknown product, treat as premium for backward compat
            await assignTierRole(userId, 'premium')
            logger.warn({ productId }, 'Webhook: unknown productId, defaulting to premium')
          }

          publish('subscription:updated', { tier: tier ?? 'premium' }, {
            localUserIds: [userId],
            remoteHandles: [],
          })
          logger.info({ userId, polarCustomerId, tier }, 'Subscription activated')
          break
        }

        case 'subscription.canceled':
        case 'subscription.revoked': {
          const polarCustomerId = data.customerId as string
          const productId = data.productId as string | undefined
          const user = await findUserByPolarCustomerId(polarCustomerId)

          if (!user) {
            logger.warn(
              { polarCustomerId },
              `Webhook: no user found for ${type}`,
            )
            return status(200, { received: true })
          }

          const tier = productId ? resolveProductTier(productId) : null
          if (tier && tier !== 'free') {
            await removeTierRole(user.id, tier)
          } else {
            // Fallback: unknown product, remove both
            await removeTierRole(user.id, 'basic')
            await removeTierRole(user.id, 'premium')
          }

          // Get the user's current status after removal
          const currentStatus = await getSubscriptionStatus(user.id)
          publish('subscription:updated', { tier: currentStatus.tier }, {
            localUserIds: [user.id],
            remoteHandles: [],
          })
          logger.info(
            { userId: user.id, polarCustomerId, tier },
            `Subscription ${type.split('.')[1]}`,
          )
          break
        }

        default:
          logger.debug({ type }, 'Unhandled webhook event')
      }

      return { received: true }
    },
    {
      parse: ({ request, contentType }) => {
        if (contentType === 'application/json') return request.text()
      },
      detail: {
        tags: ['Subscriptions'],
        summary: 'Handle Polar webhook events',
      },
    },
  )

  // Authenticated routes — each chains .use(requireAuth) individually
  // so the webhook route above stays unauthenticated.
  const authed = new Elysia().use(requireAuth)

  app.use(
    authed

      .post(
        '/checkout',
        async ({ user, body }) => {
          const fullUser = await fetchUser(user.id)
          const successUrl = `${process.env.CLIENT_ORIGIN}/settings/account?checkout=success`
          const tier = body.tier ?? 'basic'

          // Map tier to product ID
          let productId: string
          if (tier === 'premium') {
            productId = billing.premiumProductId
          } else {
            productId = billing.basicProductId
          }

          if (!productId) {
            throw new Error('Product not configured for this tier')
          }

          const checkoutUrl = await createCheckoutSession(
            user.id,
            fullUser.email,
            successUrl,
            productId,
          )
          return { checkoutUrl }
        },
        {
          body: t.Object({
            tier: t.Optional(t.Union([t.Literal('basic'), t.Literal('premium')])),
          }),
          detail: {
            tags: ['Subscriptions'],
            summary: 'Create a Polar checkout session for subscription upgrade',
          },
        },
      )

      .get(
        '/portal',
        async ({ user, status }) => {
          const fullUser = await fetchUser(user.id)
          if (!fullUser.polarCustomerId) {
            return status(404, { message: 'No subscription found' })
          }
          const portalUrl = await getCustomerPortalUrl(fullUser.polarCustomerId)
          return { portalUrl }
        },
        {
          detail: {
            tags: ['Subscriptions'],
            summary: 'Get Polar customer portal URL',
          },
        },
      )

      .get(
        '/status',
        async ({ user }) => {
          return getSubscriptionStatus(user.id)
        },
        {
          detail: {
            tags: ['Subscriptions'],
            summary: 'Get current subscription status',
          },
        },
      )

      .get(
        '/details',
        async ({ user }) => {
          const details = await getSubscriptionDetails(user.id)
          return { details }
        },
        {
          detail: {
            tags: ['Subscriptions'],
            summary: 'Get rich subscription details from Polar',
          },
        },
      )

      .post(
        '/verify',
        async ({ user }) => {
          const fullUser = await fetchUser(user.id)
          const result = await verifyAndSyncSubscription(user.id, fullUser.email)
          if (result) return result
          return getSubscriptionStatus(user.id)
        },
        {
          detail: {
            tags: ['Subscriptions'],
            summary: 'Verify subscription status directly with Polar',
          },
        },
      ),
  )
}

export default app
