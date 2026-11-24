import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatch } from '@/lib/realtime/realtime-events'

const adopt = vi.hoisted(() => vi.fn())
const auth = vi.hoisted(() => ({ me: { id: '1' } as { id: string } | null }))
vi.mock('./account-preferences', () => ({ adoptAccountPreferences: adopt }))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: () => auth }))
vi.mock('@/services/preferences.service', () => ({ PREFERENCES_ORIGIN: 'this-tab', fetchPreferences: vi.fn() }))

await import('./preferences.realtime')

const preferences = { language: 'en-US', unitSystem: 'metric', navigation: {}, ask: {}, app: {} }

describe('preferences realtime', () => {
  beforeEach(() => {
    adopt.mockClear()
    auth.me = { id: '1' }
  })

  it("takes another device's change", () => {
    dispatch('preferences:updated', { ...preferences, origin: 'other-tab' })
    expect(adopt).toHaveBeenCalledWith(preferences)
  })

  it('skips the echo of its own change', () => {
    dispatch('preferences:updated', { ...preferences, origin: 'this-tab' })
    expect(adopt).not.toHaveBeenCalled()
  })

  it('ignores changes once signed out', () => {
    auth.me = null
    dispatch('preferences:updated', { ...preferences, origin: 'other-tab' })
    expect(adopt).not.toHaveBeenCalled()
  })
})
