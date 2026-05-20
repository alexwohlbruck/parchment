import { describe, test, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  apiGetSpy: vi.fn(),
  apiPostSpy: vi.fn(),
  getPermissionsSpy: vi.fn().mockResolvedValue(undefined),
  mockSubscription: null as { isPremium: boolean; hasSubscription: boolean; tier: string } | null,
}))

vi.mock('@/lib/api', () => ({
  api: {
    get: hoisted.apiGetSpy,
    post: hoisted.apiPostSpy,
  },
}))

vi.mock('@/services/auth.service', () => ({
  useAuthService: () => ({
    getPermissions: hoisted.getPermissionsSpy,
  }),
}))

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({
    subscription: hoisted.mockSubscription,
  }),
}))

vi.mock('@vueuse/core', () => ({
  createSharedComposable: (fn: Function) => fn,
}))

describe('subscriptionService', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    hoisted.mockSubscription = null
    hoisted.apiGetSpy.mockImplementation((url: string) => {
      if (url === '/subscriptions/config')
        return Promise.resolve({ data: { billingEnabled: true } })
      return Promise.reject(new Error(`Unexpected GET ${url}`))
    })
  })

  async function createService() {
    vi.resetModules()
    const mod = await import('./subscription.service')
    const svc = mod.useSubscriptionService()
    await vi.waitFor(() => {
      expect(hoisted.apiGetSpy).toHaveBeenCalledWith('/subscriptions/config')
    })
    return svc
  }

  test('isPremium returns true when subscription says premium', async () => {
    hoisted.mockSubscription = { isPremium: true, hasSubscription: true, tier: 'premium' }
    const svc = await createService()
    expect(svc.isPremium.value).toBe(true)
  })

  test('isPremium returns false when no subscription data', async () => {
    hoisted.mockSubscription = null
    const svc = await createService()
    expect(svc.isPremium.value).toBe(false)
  })

  test('isPremium returns false when subscription says not premium', async () => {
    hoisted.mockSubscription = { isPremium: false, hasSubscription: false, tier: 'free' }
    const svc = await createService()
    expect(svc.isPremium.value).toBe(false)
  })

  test('hasSubscription derived from auth store', async () => {
    hoisted.mockSubscription = { isPremium: true, hasSubscription: true, tier: 'premium' }
    const svc = await createService()
    expect(svc.hasSubscription.value).toBe(true)
  })

  test('tier computed returns correct string', async () => {
    hoisted.mockSubscription = { isPremium: true, hasSubscription: true, tier: 'premium' }
    const svc = await createService()
    expect(svc.tier.value).toBe('premium')

    hoisted.mockSubscription = { isPremium: false, hasSubscription: false, tier: 'free' }
    const svc2 = await createService()
    expect(svc2.tier.value).toBe('free')
  })

  test('startCheckout calls the correct API endpoint', async () => {
    hoisted.apiPostSpy.mockResolvedValue({
      data: { checkoutUrl: 'https://polar.sh/checkout/abc' },
    })

    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, href: '' },
    })

    const svc = await createService()
    await svc.startCheckout()

    expect(hoisted.apiPostSpy).toHaveBeenCalledWith('/subscriptions/checkout')
    expect(window.location.href).toBe('https://polar.sh/checkout/abc')

    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    })
  })

  test('verifySubscription calls POST /verify and re-fetches permissions', async () => {
    hoisted.apiPostSpy.mockResolvedValue({
      data: { isPremium: true, hasSubscription: true, tier: 'premium' },
    })
    const svc = await createService()
    const result = await svc.verifySubscription()
    expect(hoisted.apiPostSpy).toHaveBeenCalledWith('/subscriptions/verify')
    expect(result.isPremium).toBe(true)
    expect(hoisted.getPermissionsSpy).toHaveBeenCalled()
  })

  test('refreshStatus re-fetches permissions', async () => {
    const svc = await createService()
    await svc.refreshStatus()
    expect(hoisted.getPermissionsSpy).toHaveBeenCalled()
  })
})
