import { describe, test, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  apiGetSpy: vi.fn(),
  apiPostSpy: vi.fn(),
  hasPermissionSpy: vi.fn(() => false),
}))

vi.mock('@/lib/api', () => ({
  api: {
    get: hoisted.apiGetSpy,
    post: hoisted.apiPostSpy,
  },
}))

vi.mock('@/services/auth.service', () => ({
  useAuthService: () => ({
    hasPermission: hoisted.hasPermissionSpy,
    getPermissions: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@vueuse/core', () => ({
  createSharedComposable: (fn: Function) => fn,
}))

describe('subscriptionService', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    hoisted.apiGetSpy.mockResolvedValue({ data: { billingEnabled: true } })
  })

  async function createService() {
    // Force fresh module with each test
    vi.resetModules()
    const mod = await import('./subscription.service')
    const svc = mod.useSubscriptionService()
    // Let the initial fetchConfig resolve
    await vi.waitFor(() => {
      expect(hoisted.apiGetSpy).toHaveBeenCalledWith('/subscriptions/config')
    })
    return svc
  }

  test('isPremium returns true when user has premium permission', async () => {
    hoisted.hasPermissionSpy.mockReturnValue(true)
    const svc = await createService()
    expect(svc.isPremium.value).toBe(true)
  })

  test('isPremium returns true when billing is disabled (self-hosted)', async () => {
    hoisted.apiGetSpy.mockResolvedValue({ data: { billingEnabled: false } })
    const svc = await createService()
    expect(svc.isPremium.value).toBe(true)
  })

  test('isPremium returns false for free user with billing enabled', async () => {
    hoisted.hasPermissionSpy.mockReturnValue(false)
    const svc = await createService()
    expect(svc.isPremium.value).toBe(false)
  })

  test('tier computed returns correct string', async () => {
    hoisted.hasPermissionSpy.mockReturnValue(true)
    const svc = await createService()
    expect(svc.tier.value).toBe('premium')

    hoisted.hasPermissionSpy.mockReturnValue(false)
    const svc2 = await createService()
    expect(svc2.tier.value).toBe('free')
  })

  test('startCheckout calls the correct API endpoint', async () => {
    hoisted.apiPostSpy.mockResolvedValue({
      data: { checkoutUrl: 'https://polar.sh/checkout/abc' },
    })

    // Mock window.location
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

  test('refreshStatus re-fetches permissions after premium status', async () => {
    hoisted.apiGetSpy.mockImplementation((url: string) => {
      if (url === '/subscriptions/config')
        return Promise.resolve({ data: { billingEnabled: true } })
      if (url === '/subscriptions/status')
        return Promise.resolve({ data: { isPremium: true, tier: 'premium' } })
      return Promise.reject(new Error(`Unexpected GET ${url}`))
    })

    const svc = await createService()
    const result = await svc.refreshStatus()

    expect(result.isPremium).toBe(true)
    expect(hoisted.apiGetSpy).toHaveBeenCalledWith('/subscriptions/status')
  })
})
