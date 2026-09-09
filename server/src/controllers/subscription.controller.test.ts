/**
 * Endpoint tests for the subscriptions controller with billing enabled.
 *
 * The webhook is the unauthenticated half and carries the money-adjacent
 * logic, so it gets the most attention: an unverified signature must never
 * reach a role change, and when Polar's metadata disagrees with our own
 * customer link, the link wins (metadata is client-supplied at checkout).
 *
 * The billing-disabled build of this controller is covered separately in
 * subscription.controller.disabled.test.ts — `billing.enabled` is read at
 * import time, so the two shapes can't share a module registry.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { authMockModule, setAuthUser, resetAuth, TEST_USER } from '../test/auth-mock'
import { createTestApp, req } from '../test/app'

class WebhookVerificationError extends Error {}

/** Event returned by validateEvent; set per test. */
let webhookEvent: { type: string; data: Record<string, unknown> } | null = null
let webhookError: Error | null = null

const validateEvent = mock(() => {
  if (webhookError) throw webhookError
  return webhookEvent
})

mock.module('@polar-sh/sdk/webhooks', () => ({
  validateEvent,
  WebhookVerificationError,
}))

mock.module('../config', () => ({
  billing: {
    enabled: true,
    webhookSecret: 'whsec',
    basicProductId: 'prod_basic',
    premiumProductId: 'prod_premium',
    organizationId: 'org_1',
  },
  origins: { clientOrigin: 'https://app.parchment.test' },
  appName: 'Parchment',
  isSelfHosted: false,
  registrationMode: 'invite',
}))

const fetchUser = mock(async (id: string) => ({
  id,
  email: 'user@parchment.test',
  polarCustomerId: 'cus_1' as string | null,
}))
mock.module('../services/user.service', () => ({ fetchUser }))

const createCheckoutSession = mock(
  async (_userId: string, _email: string, _successUrl: string, _productId: string) =>
    'https://polar.sh/checkout/abc',
)
const getCustomerPortalUrl = mock(async (_customerId: string) => 'https://polar.sh/portal')
const getSubscriptionStatus = mock(async (_userId: string) => ({
  isPremium: true,
  isBasic: false,
  hasSubscription: true,
  tier: 'premium',
}))
const getSubscriptionDetails = mock(async (_userId: string) => ({ renewsAt: 'soon' }))
const getProductsInfo = mock(async () => ({ basic: { name: 'Basic' }, premium: null }))
const verifyAndSyncSubscription = mock(async (_userId: string, _email: string) => ({
  isPremium: true,
  isBasic: false,
  hasSubscription: true,
  tier: 'premium',
}))
const assignTierRole = mock(async (_userId: string, _tier: string) => undefined)
const removeTierRole = mock(async (_userId: string, _tier: string) => undefined)
const resolveProductTier = mock((productId: string) =>
  productId === 'prod_premium' ? 'premium' : productId === 'prod_basic' ? 'basic' : null,
)
const linkPolarCustomer = mock(async (_userId: string, _customerId: string) => undefined)
const findUserByPolarCustomerId = mock(
  async (_customerId: string) => null as { id: string } | null,
)

mock.module('../services/subscription.service', () => ({
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
}))

const publish = mock((_event: string, _payload: unknown, _targets: unknown) => undefined)
mock.module('../services/realtime/event-bus.service', () => ({ publish }))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
}))

mock.module('../middleware/auth.middleware', () => authMockModule())

process.env.CLIENT_ORIGIN = 'https://app.parchment.test'

const subscriptions = (await import('./subscription.controller')).default
const app = createTestApp(subscriptions)

/** POST the webhook with a raw JSON string body, as Polar sends it. */
async function postWebhook(payload: unknown = { anything: true }) {
  const response = await app.handle(
    new Request('http://localhost/subscriptions/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'webhook-signature': 'sig' },
      body: JSON.stringify(payload),
    }),
  )
  const text = await response.text()
  let body: any = text
  try {
    body = JSON.parse(text)
  } catch {
    /* non-JSON */
  }
  return { status: response.status, body }
}

beforeEach(() => {
  resetAuth()
  webhookEvent = null
  webhookError = null
  validateEvent.mockClear()
  fetchUser.mockClear()
  fetchUser.mockImplementation(async (id: string) => ({
    id,
    email: 'user@parchment.test',
    polarCustomerId: 'cus_1',
  }))
  createCheckoutSession.mockClear()
  getCustomerPortalUrl.mockClear()
  getSubscriptionStatus.mockClear()
  getSubscriptionStatus.mockImplementation(async () => ({
    isPremium: true,
    isBasic: false,
    hasSubscription: true,
    tier: 'premium',
  }))
  getSubscriptionDetails.mockClear()
  getProductsInfo.mockClear()
  verifyAndSyncSubscription.mockClear()
  assignTierRole.mockClear()
  removeTierRole.mockClear()
  linkPolarCustomer.mockClear()
  findUserByPolarCustomerId.mockClear()
  findUserByPolarCustomerId.mockImplementation(async () => null)
  publish.mockClear()
})

describe('GET /subscriptions/config', () => {
  test('reports billing enabled with product info, unauthenticated', async () => {
    setAuthUser(null)

    const res = await req(app).get('/subscriptions/config')

    expect(res.status).toBe(200)
    expect(res.body.billingEnabled).toBe(true)
    expect(res.body.products.basic.name).toBe('Basic')
  })
})

describe('POST /subscriptions/webhook — signature verification', () => {
  test('400s on a bad signature without touching roles', async () => {
    webhookError = new WebhookVerificationError('bad sig')

    const res = await postWebhook()

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid webhook signature')
    expect(assignTierRole).not.toHaveBeenCalled()
    expect(linkPolarCustomer).not.toHaveBeenCalled()
  })

  test('400s on a malformed payload', async () => {
    webhookError = new Error('not a valid event')

    const res = await postWebhook()

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid webhook payload')
  })

  test('is unauthenticated — Polar has no session', async () => {
    setAuthUser(null)
    webhookEvent = { type: 'unhandled.event', data: {} }

    const res = await postWebhook()

    expect(res.status).toBe(200)
  })

  test('acknowledges an event type it does not handle', async () => {
    webhookEvent = { type: 'order.created', data: {} }

    const res = await postWebhook()

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true })
    expect(assignTierRole).not.toHaveBeenCalled()
  })
})

describe('POST /subscriptions/webhook — subscription.active', () => {
  test('links the customer and grants the matching tier', async () => {
    findUserByPolarCustomerId.mockResolvedValueOnce({ id: 'user-9' })
    webhookEvent = {
      type: 'subscription.active',
      data: { customerId: 'cus_9', productId: 'prod_premium' },
    }

    const res = await postWebhook()

    expect(res.status).toBe(200)
    expect(linkPolarCustomer).toHaveBeenCalledWith('user-9', 'cus_9')
    expect(assignTierRole).toHaveBeenCalledWith('user-9', 'premium')
  })

  test('grants the basic tier for the basic product', async () => {
    findUserByPolarCustomerId.mockResolvedValueOnce({ id: 'user-9' })
    webhookEvent = {
      type: 'subscription.active',
      data: { customerId: 'cus_9', productId: 'prod_basic' },
    }

    await postWebhook()

    expect(assignTierRole).toHaveBeenCalledWith('user-9', 'basic')
  })

  test('falls back to premium for an unrecognized product', async () => {
    findUserByPolarCustomerId.mockResolvedValueOnce({ id: 'user-9' })
    webhookEvent = {
      type: 'subscription.active',
      data: { customerId: 'cus_9', productId: 'prod_mystery' },
    }

    await postWebhook()

    expect(assignTierRole).toHaveBeenCalledWith('user-9', 'premium')
  })

  test('falls back to the checkout metadata when no customer is linked yet', async () => {
    webhookEvent = {
      type: 'subscription.active',
      data: {
        customerId: 'cus_new',
        productId: 'prod_basic',
        metadata: { parchmentUserId: 'user-from-metadata' },
      },
    }

    await postWebhook()

    expect(linkPolarCustomer).toHaveBeenCalledWith('user-from-metadata', 'cus_new')
    expect(assignTierRole).toHaveBeenCalledWith('user-from-metadata', 'basic')
  })

  test('the existing link wins when metadata names a different user', async () => {
    // Metadata is supplied at checkout time and is not authoritative; the
    // stored customer link is.
    findUserByPolarCustomerId.mockResolvedValueOnce({ id: 'linked-user' })
    webhookEvent = {
      type: 'subscription.active',
      data: {
        customerId: 'cus_9',
        productId: 'prod_premium',
        metadata: { parchmentUserId: 'attacker-user' },
      },
    }

    await postWebhook()

    expect(assignTierRole).toHaveBeenCalledWith('linked-user', 'premium')
    expect(assignTierRole).not.toHaveBeenCalledWith('attacker-user', 'premium')
  })

  test('acknowledges without granting anything when no user can be resolved', async () => {
    webhookEvent = {
      type: 'subscription.active',
      data: { customerId: 'cus_unknown', productId: 'prod_premium' },
    }

    const res = await postWebhook()

    expect(res.status).toBe(200)
    expect(assignTierRole).not.toHaveBeenCalled()
    expect(linkPolarCustomer).not.toHaveBeenCalled()
  })

  test('publishes the new tier to the affected user only', async () => {
    findUserByPolarCustomerId.mockResolvedValueOnce({ id: 'user-9' })
    webhookEvent = {
      type: 'subscription.active',
      data: { customerId: 'cus_9', productId: 'prod_basic' },
    }

    await postWebhook()

    expect(publish).toHaveBeenCalledWith(
      'subscription:updated',
      { tier: 'basic' },
      { localUserIds: ['user-9'], remoteHandles: [] },
    )
  })
})

describe('POST /subscriptions/webhook — cancellation', () => {
  for (const type of ['subscription.canceled', 'subscription.revoked']) {
    test(`${type} removes the matching tier`, async () => {
      findUserByPolarCustomerId.mockResolvedValueOnce({ id: 'user-9' })
      webhookEvent = {
        type,
        data: { customerId: 'cus_9', productId: 'prod_premium' },
      }

      const res = await postWebhook()

      expect(res.status).toBe(200)
      expect(removeTierRole).toHaveBeenCalledWith('user-9', 'premium')
    })
  }

  test('removes both paid tiers when the product is unrecognized', async () => {
    findUserByPolarCustomerId.mockResolvedValueOnce({ id: 'user-9' })
    webhookEvent = {
      type: 'subscription.revoked',
      data: { customerId: 'cus_9', productId: 'prod_mystery' },
    }

    await postWebhook()

    const removed = removeTierRole.mock.calls.map((c) => c[1])
    expect(removed).toEqual(['basic', 'premium'])
  })

  test('publishes the tier the user actually has left', async () => {
    findUserByPolarCustomerId.mockResolvedValueOnce({ id: 'user-9' })
    getSubscriptionStatus.mockResolvedValueOnce({
      isPremium: false,
      isBasic: true,
      hasSubscription: true,
      tier: 'basic',
    })
    webhookEvent = {
      type: 'subscription.canceled',
      data: { customerId: 'cus_9', productId: 'prod_premium' },
    }

    await postWebhook()

    expect(publish.mock.calls[0][1]).toEqual({ tier: 'basic' })
  })

  test('acknowledges when the customer maps to no user', async () => {
    webhookEvent = {
      type: 'subscription.canceled',
      data: { customerId: 'cus_unknown' },
    }

    const res = await postWebhook()

    expect(res.status).toBe(200)
    expect(removeTierRole).not.toHaveBeenCalled()
  })
})

describe('POST /subscriptions/checkout', () => {
  test('rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).post('/subscriptions/checkout', { body: {} })

    expect(res.status).toBe(401)
    expect(createCheckoutSession).not.toHaveBeenCalled()
  })

  test('defaults to the basic tier', async () => {
    const res = await req(app).post('/subscriptions/checkout', { body: {} })

    expect(res.status).toBe(200)
    expect(res.body.checkoutUrl).toContain('polar.sh/checkout')
    expect(createCheckoutSession.mock.calls[0][3]).toBe('prod_basic')
  })

  test('uses the premium product when premium is requested', async () => {
    await req(app).post('/subscriptions/checkout', { body: { tier: 'premium' } })

    expect(createCheckoutSession.mock.calls[0][3]).toBe('prod_premium')
  })

  test('accepts a success URL on the client origin', async () => {
    await req(app).post('/subscriptions/checkout', {
      body: { successUrl: 'https://app.parchment.test/welcome' },
    })

    expect(createCheckoutSession.mock.calls[0][2]).toBe(
      'https://app.parchment.test/welcome',
    )
  })

  test('ignores an off-origin success URL — no open redirect', async () => {
    await req(app).post('/subscriptions/checkout', {
      body: { successUrl: 'https://evil.test/steal' },
    })

    expect(createCheckoutSession.mock.calls[0][2]).toBe(
      'https://app.parchment.test/settings/account?checkout=success',
    )
  })

  test('ignores a malformed success URL', async () => {
    await req(app).post('/subscriptions/checkout', {
      body: { successUrl: 'not-a-url' },
    })

    expect(createCheckoutSession.mock.calls[0][2]).toContain('app.parchment.test')
  })

  test('422s on an unknown tier', async () => {
    const res = await req(app).post('/subscriptions/checkout', {
      body: { tier: 'platinum' },
    })

    expect(res.status).toBe(422)
    expect(createCheckoutSession).not.toHaveBeenCalled()
  })
})

describe('GET /subscriptions/portal', () => {
  test('returns the portal URL for a linked customer', async () => {
    const res = await req(app).get('/subscriptions/portal')

    expect(res.status).toBe(200)
    expect(res.body.portalUrl).toBe('https://polar.sh/portal')
    expect(getCustomerPortalUrl).toHaveBeenCalledWith('cus_1')
  })

  test('404s when the user has never subscribed', async () => {
    fetchUser.mockResolvedValueOnce({
      id: TEST_USER.id,
      email: 'user@parchment.test',
      polarCustomerId: null,
    })

    const res = await req(app).get('/subscriptions/portal')

    expect(res.status).toBe(404)
    expect(getCustomerPortalUrl).not.toHaveBeenCalled()
  })

  test('rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).get('/subscriptions/portal')

    expect(res.status).toBe(401)
  })
})

describe('GET /subscriptions/status and /details', () => {
  test('status returns the caller’s tier', async () => {
    const res = await req(app).get('/subscriptions/status')

    expect(res.status).toBe(200)
    expect(res.body.tier).toBe('premium')
    expect(getSubscriptionStatus).toHaveBeenCalledWith(TEST_USER.id)
  })

  test('details wraps the Polar payload', async () => {
    const res = await req(app).get('/subscriptions/details')

    expect(res.status).toBe(200)
    expect(res.body.details).toEqual({ renewsAt: 'soon' })
  })

  test('both reject an unauthenticated caller', async () => {
    setAuthUser(null)

    expect((await req(app).get('/subscriptions/status')).status).toBe(401)
    expect((await req(app).get('/subscriptions/details')).status).toBe(401)
  })
})

describe('POST /subscriptions/verify', () => {
  test('reconciles against Polar and returns the result', async () => {
    const res = await req(app).post('/subscriptions/verify')

    expect(res.status).toBe(200)
    expect(verifyAndSyncSubscription).toHaveBeenCalledWith(
      TEST_USER.id,
      'user@parchment.test',
    )
    expect(res.body.tier).toBe('premium')
  })

  test('falls back to the stored status when the sync returns nothing', async () => {
    verifyAndSyncSubscription.mockResolvedValueOnce(null as any)

    const res = await req(app).post('/subscriptions/verify')

    expect(res.status).toBe(200)
    expect(getSubscriptionStatus).toHaveBeenCalledWith(TEST_USER.id)
  })

  test('rejects an unauthenticated caller', async () => {
    setAuthUser(null)

    const res = await req(app).post('/subscriptions/verify')

    expect(res.status).toBe(401)
    expect(verifyAndSyncSubscription).not.toHaveBeenCalled()
  })
})
