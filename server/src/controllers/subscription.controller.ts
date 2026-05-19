import Elysia, { t } from 'elysia'
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks'
import { requireAuth } from '../middleware/auth.middleware'
import { billing } from '../config'
import { fetchUser } from '../services/user.service'
import {
  createCheckoutSession,
  getCustomerPortalUrl,
  getSubscriptionStatus,
  verifyAndSyncSubscription,
  assignPremiumRole,
  removePremiumRole,
  linkPolarCustomer,
  findUserByPolarCustomerId,
} from '../services/subscription.service'
import { logger } from '../lib/logger'
import { publish } from '../services/realtime/event-bus.service'

const app = new Elysia({ prefix: '/subscriptions' })

app.get(
  '/config',
  () => ({ billingEnabled: billing.enabled }),
  {
    detail: {
      tags: ['Subscriptions'],
      summary: 'Get billing configuration',
    },
  },
)

if (billing.enabled) {
  // Webhook must be registered BEFORE requireAuth is applied to the
  // instance — Elysia's .use() mutates the app and would otherwise
  // gate this unauthenticated endpoint behind session checks.
  app.post(
    '/webhook',
    async ({ body, request, status }) => {
      const rawBody = body as string
      const headers: Record<string, string> = {}
      request.headers.forEach((value, key) => {
        headers[key] = value
      })

      let event: ReturnType<typeof validateEvent> extends Promise<infer T>
        ? T
        : never
      try {
        event = validateEvent(rawBody, headers, billing.webhookSecret)
      } catch (err) {
        if (err instanceof WebhookVerificationError) {
          logger.warn('Webhook signature verification failed')
          return status(400, { message: 'Invalid webhook signature' })
        }
        logger.warn({ errorName: (err as Error).name }, 'Webhook event validation failed')
        return status(400, { message: 'Invalid webhook payload' })
      }

      const type = (event as { type: string }).type
      const data = (event as { data: any }).data

      switch (type) {
        case 'subscription.active': {
          const polarCustomerId = data.customerId as string
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
          await assignPremiumRole(userId)
          publish('subscription:updated', { isPremium: true, tier: 'premium' }, {
            localUserIds: [userId],
            remoteHandles: [],
          })
          logger.info({ userId, polarCustomerId }, 'Subscription activated')
          break
        }

        case 'subscription.canceled':
        case 'subscription.revoked': {
          const polarCustomerId = data.customerId as string
          const user = await findUserByPolarCustomerId(polarCustomerId)

          if (!user) {
            logger.warn(
              { polarCustomerId },
              `Webhook: no user found for ${type}`,
            )
            return status(200, { received: true })
          }

          await removePremiumRole(user.id)
          publish('subscription:updated', { isPremium: false, tier: 'free' }, {
            localUserIds: [user.id],
            remoteHandles: [],
          })
          logger.info(
            { userId: user.id, polarCustomerId },
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

  // Authenticated routes — requireAuth applied after webhook registration
  app.use(requireAuth)

  app.post(
    '/checkout',
    async ({ user }) => {
      const fullUser = await fetchUser(user.id)
      const successUrl = `${process.env.CLIENT_ORIGIN}/settings/billing?checkout=success`
      const checkoutUrl = await createCheckoutSession(
        user.id,
        fullUser.email,
        successUrl,
      )
      return { checkoutUrl }
    },
    {
      detail: {
        tags: ['Subscriptions'],
        summary: 'Create a Polar checkout session for premium upgrade',
      },
    },
  )

  app.get(
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

  app.get(
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

  app.post(
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
  )
}

export default app
