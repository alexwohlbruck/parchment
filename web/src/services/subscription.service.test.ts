import { describe, test, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  apiGetSpy: vi.fn(),
  apiPostSpy: vi.fn(),
  getPermissionsSpy: vi.fn().mockResolvedValue(undefined),
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

vi.mock('@vueuse/core', () => ({
  createSharedComposable: (fn: Function) => fn,
}))

describe('subscriptionService', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    hoisted.apiGetSpy.mockImplementation((url: string) => {
      if (url === '/subscriptions/config')
        return Promise.resolve({ data: { billingEnabled: true } })
      if (url === '/subscriptions/status')
        return Promise.resolve({
          data: { isPremium: false, hasSubscription: false, tier: 'free' },
        })
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

  test('isPremium returns true when status API reports premium', async () => {
    hoisted.apiGetSpy.mockImplementation((url: string) => {
      if (url === '/subscriptions/config')
        return Promise.resolve({ data: { billingEnabled: true } })
      if (url === '/subscriptions/status')
        return Promise.resolve({
          data: { isPremium: true, hasSubscription: true, tier: 'premium' },
        })
      return Promise.reject(new Error(`Unexpected GET ${url}`))
    })
    const svc = await createService()
    await vi.waitFor(() => expect(svc.statusLoaded.value).toBe(true))
    expect(svc.isPremium.value).toBe(true)
  })

  test('isPremium returns true when billing is disabled (self-hosted)', async () => {
    hoisted.apiGetSpy.mockImplementation((url: string) => {
      if (url === '/subscriptions/config')
        return Promise.resolve({ data: { billingEnabled: false } })
      if (url === '/subscriptions/status')
        return Promise.reject(new Error('should not be called'))
      return Promise.reject(new Error(`Unexpected GET ${url}`))
    })
    const svc = await createService()
    expect(svc.isPremium.value).toBe(true)
  })

  test('isPremium returns false for free user with billing enabled', async () => {
    const svc = await createService()
    await vi.waitFor(() => expect(svc.statusLoaded.value).toBe(true))
    expect(svc.isPremium.value).toBe(false)
  })

  test('tier computed returns correct string', async () => {
    hoisted.apiGetSpy.mockImplementation((url: string) => {
      if (url === '/subscriptions/config')
        return Promise.resolve({ data: { billingEnabled: true } })
      if (url === '/subscriptions/status')
        return Promise.resolve({
          data: { isPremium: true, hasSubscription: true, tier: 'premium' },
        })
      return Promise.reject(new Error(`Unexpected GET ${url}`))
    })
    const svc = await createService()
    await vi.waitFor(() => expect(svc.statusLoaded.value).toBe(true))
    expect(svc.tier.value).toBe('premium')

    // Free tier
    hoisted.apiGetSpy.mockImplementation((url: string) => {
      if (url === '/subscriptions/config')
        return Promise.resolve({ data: { billingEnabled: true } })
      if (url === '/subscriptions/status')
        return Promise.resolve({
          data: { isPremium: false, hasSubscription: false, tier: 'free' },
        })
      return Promise.reject(new Error(`Unexpected GET ${url}`))
    })
    const svc2 = await createService()
    await vi.waitFor(() => expect(svc2.statusLoaded.value).toBe(true))
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

  test('verifySubscription calls POST /verify and updates state', async () => {
    hoisted.apiPostSpy.mockResolvedValue({
      data: { isPremium: true, hasSubscription: true, tier: 'premium' },
    })
    const svc = await createService()
    const result = await svc.verifySubscription()
    expect(hoisted.apiPostSpy).toHaveBeenCalledWith('/subscriptions/verify')
    expect(result.isPremium).toBe(true)
    expect(svc.hasPremiumRole.value).toBe(true)
    expect(svc.hasSubscription.value).toBe(true)
    expect(hoisted.getPermissionsSpy).toHaveBeenCalled()
  })

  test('verifySubscription handles cancelled subscription', async () => {
    hoisted.apiPostSpy.mockResolvedValue({
      data: { isPremium: false, hasSubscription: true, tier: 'free' },
    })
    const svc = await createService()
    const result = await svc.verifySubscription()
    expect(result.isPremium).toBe(false)
    expect(svc.hasPremiumRole.value).toBe(false)
    expect(svc.hasSubscription.value).toBe(true)
  })

  test('refreshStatus re-fetches permissions after premium status', async () => {
    hoisted.apiGetSpy.mockImplementation((url: string) => {
      if (url === '/subscriptions/config')
        return Promise.resolve({ data: { billingEnabled: true } })
      if (url === '/subscriptions/status')
        return Promise.resolve({
          data: { isPremium: true, hasSubscription: true, tier: 'premium' },
        })
      return Promise.reject(new Error(`Unexpected GET ${url}`))
    })

    const svc = await createService()
    const result = await svc.refreshStatus()

    expect(result.isPremium).toBe(true)
    expect(hoisted.apiGetSpy).toHaveBeenCalledWith('/subscriptions/status')
    expect(hoisted.getPermissionsSpy).toHaveBeenCalled()
  })
})
