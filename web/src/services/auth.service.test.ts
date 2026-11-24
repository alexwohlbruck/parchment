import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { OfflineRequestError } from '@/lib/network-errors'

const state = vi.hoisted(() => ({ get: vi.fn() }))
const authStore = vi.hoisted(() => ({
  me: undefined as any,
  isImpersonating: false,
  updateUser: vi.fn(),
  unsetAuthenticatedUser: vi.fn(),
  setAuthenticatedUserPromise: vi.fn(),
  setAuthenticatedUser: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ api: { get: state.get, defaults: { headers: { common: {} } } }, isTauri: false }))
vi.mock('@/router', () => ({ default: {} }))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: () => authStore }))
vi.mock('@/stores/identity.store', () => ({ useIdentityStore: () => ({}) }))
vi.mock('@/stores/vehicles.store', () => ({ useVehiclesStore: () => ({}) }))
vi.mock('@/stores/preferences/account-preferences', () => ({ adoptAccountPreferences: vi.fn() }))
vi.mock('@/services/app.service', () => ({ useAppService: () => ({}) }))
vi.mock('@/services/integration.service', () => ({ useIntegrationService: () => ({}) }))
vi.mock('@/services/cache.service', () => ({ clearAllUserCaches: vi.fn() }))
vi.mock('@/services/preferences.service', () => ({ fetchPreferences: vi.fn() }))
vi.mock('@/lib/device-store', () => ({ auth: {} }))

import { useAuthService } from './auth.service'

const user = { id: '1', email: 'someone@example.com' }

describe('getAuthenticatedUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authStore.me = undefined
  })

  it('keeps a cached user signed in when launched offline', async () => {
    authStore.me = user
    state.get.mockRejectedValue(new OfflineRequestError({ method: 'get', url: 'auth/sessions/current' } as any))

    const result = await useAuthService().getAuthenticatedUser()
    await flushPromises()

    expect(result.user).toBe(user)
    expect(authStore.updateUser).not.toHaveBeenCalled()
    expect(authStore.unsetAuthenticatedUser).not.toHaveBeenCalled()
  })

  it('treats a first launch with no connection as signed out', async () => {
    state.get.mockRejectedValue(new OfflineRequestError({ method: 'get', url: 'auth/sessions/current' } as any))

    const result = await useAuthService().getAuthenticatedUser()

    expect(result.user).toBeNull()
    expect(authStore.updateUser).toHaveBeenCalledWith(null)
  })
})
