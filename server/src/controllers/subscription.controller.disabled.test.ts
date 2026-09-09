/**
 * Endpoint tests for the subscriptions controller with billing DISABLED.
 *
 * `billing.enabled` is read once at module evaluation, so the self-hosted
 * build genuinely has no webhook or checkout routes registered — not routes
 * that answer 403. This lives in its own file because a second `mock.module`
 * for `../config` can't change what an already-evaluated controller captured.
 */

import { describe, test, expect, mock } from 'bun:test'
import { authMockModule } from '../test/auth-mock'
import { createTestApp, req } from '../test/app'

mock.module('../config', () => ({
  billing: {
    enabled: false,
    webhookSecret: '',
    basicProductId: '',
    premiumProductId: '',
  },
  origins: { clientOrigin: 'https://app.parchment.test' },
  appName: 'Parchment',
  isSelfHosted: true,
  registrationMode: 'invite',
}))

const getProductsInfo = mock(async () => ({ basic: null, premium: null }))

mock.module('../services/subscription.service', () => ({
  getProductsInfo,
  createCheckoutSession: mock(async () => ''),
  getCustomerPortalUrl: mock(async () => ''),
  getSubscriptionStatus: mock(async () => ({ tier: 'free' })),
  getSubscriptionDetails: mock(async () => null),
  verifyAndSyncSubscription: mock(async () => null),
  assignTierRole: mock(async () => undefined),
  removeTierRole: mock(async () => undefined),
  resolveProductTier: mock(() => null),
  linkPolarCustomer: mock(async () => undefined),
  findUserByPolarCustomerId: mock(async () => null),
}))

mock.module('../services/user.service', () => ({
  fetchUser: mock(async (id: string) => ({ id, email: 'u@parchment.test' })),
}))
mock.module('../services/realtime/event-bus.service', () => ({ publish: () => {} }))
mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
}))
mock.module('../middleware/auth.middleware', () => authMockModule())

const subscriptions = (await import('./subscription.controller')).default
const app = createTestApp(subscriptions)

describe('GET /subscriptions/config with billing off', () => {
  test('reports billing disabled', async () => {
    const res = await req(app).get('/subscriptions/config')

    expect(res.status).toBe(200)
    expect(res.body.billingEnabled).toBe(false)
  })

  test('does not reach Polar for product info', async () => {
    await req(app).get('/subscriptions/config')

    expect(getProductsInfo).not.toHaveBeenCalled()
  })

  test('returns null products so the client hides the upgrade UI', async () => {
    const res = await req(app).get('/subscriptions/config')

    expect(res.body.products).toBeNull()
  })
})

describe('billing routes are absent, not merely forbidden', () => {
  const absent = [
    ['post', '/subscriptions/webhook'],
    ['post', '/subscriptions/checkout'],
    ['get', '/subscriptions/portal'],
    ['get', '/subscriptions/status'],
    ['get', '/subscriptions/details'],
    ['post', '/subscriptions/verify'],
  ] as const

  for (const [method, path] of absent) {
    test(`${method.toUpperCase()} ${path} 404s`, async () => {
      const res = await req(app)[method](path, { body: {} })

      expect(res.status).toBe(404)
    })
  }
})
