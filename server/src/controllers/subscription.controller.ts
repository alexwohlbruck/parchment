import Elysia, { t } from 'elysia'
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks'
import { requireAuth } from '../middleware/auth.middleware'
import { billing } from '../config'
import { fetchUser } from '../services/user.service'
import {
  createCheckoutSession,
  getCustomerPortalUrl,
  getSubscriptionStatus,
  assignPremiumRole,
  removePremiumRole,
  linkPolarCustomer,
  findUserByPolarCustomerId,
} from '../services/subscription.service'
import { logger } from '../lib/logger'

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
  app.use(requireAuth).post(
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

  app.use(requireAuth).get(
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

  app.use(requireAuth).get(
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
    '/webhook',
    async ({ request, status }) => {
      const body = await request.text()
      const headers: Record<string, string> = {}
      request.headers.forEach((value, key) => {
        headers[key] = value
      })

      let event: ReturnType<typeof validateEvent> extends Promise<infer T>
        ? T
        : never
      try {
        event = validateEvent(body, headers, billing.webhookSecret)
      } catch (err) {
        if (err instanceof WebhookVerificationError) {
          logger.warn('Webhook signature verification failed')
          return status(400, { message: 'Invalid webhook signature' })
        }
        throw err
      }

      const type = (event as { type: string }).type
      const data = (event as { data: any }).data

      switch (type) {
        case 'subscription.active': {
          const polarCustomerId = data.customerId as string
          const parchmentUserId = data.metadata?.parchmentUserId as
            | string
            | undefined

          let userId = parchmentUserId
          if (!userId) {
            const user = await findUserByPolarCustomerId(polarCustomerId)
            userId = user?.id
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
      detail: {
        tags: ['Subscriptions'],
        summary: 'Handle Polar webhook events',
      },
    },
  )
}

export default app
