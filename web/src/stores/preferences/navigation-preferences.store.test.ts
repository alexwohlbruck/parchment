import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { nextTick } from 'vue'
import { useNavigationPreferencesStore } from './navigation-preferences.store'
import { useAuthStore } from '@/stores/auth.store'
import type { NavigationPreferences } from '@/lib/preferences/navigation-preferences'

const save = vi.hoisted(() => vi.fn(async (_patch: Partial<NavigationPreferences>) => {}))
vi.mock('@/services/preferences.service', () => ({ saveNavigationPreferences: save }))

const remote: NavigationPreferences = { excludedModes: [], sortPreference: null }

let pinia: Pinia

beforeEach(() => {
  localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
  save.mockClear()
  vi.useFakeTimers()
})
afterEach(() => {
  ;(pinia as any)._s.forEach((store: { $dispose(): void }) => store.$dispose())
  vi.useRealTimers()
})

async function settle() {
  await vi.runAllTimersAsync()
}

describe('navigation preferences store', () => {
  it('reads routing preferences saved by older versions', () => {
    localStorage.setItem('routingPreferences', JSON.stringify({ ferries: 0.25, hills: 0.2 }))
    const store = useNavigationPreferencesStore()
    expect(store.routing.general.ferries).toBe(0.25)
    expect(store.routing.mode.walking.hills).toBe(0.2)
  })

  it('keeps changes on the device', async () => {
    const store = useNavigationPreferencesStore()
    store.setModePreference('transit', 'transitBufferMinutes', 4)
    store.setModeEnabled('driving', false)
    await nextTick()
    expect(JSON.parse(localStorage.getItem('routingPreferences')!).mode.transit.transitBufferMinutes).toBe(4)
    expect(JSON.parse(localStorage.getItem('excluded-modes')!)).toEqual(['driving'])
    expect(store.transitBufferMinutes).toBe(4)
  })

  it('does not save to the account before it has loaded', async () => {
    const store = useNavigationPreferencesStore()
    store.setModeEnabled('driving', false)
    await settle()
    expect(save).not.toHaveBeenCalled()
  })

  it('takes the account values without echoing them back', async () => {
    const store = useNavigationPreferencesStore()
    store.adopt({
      ...remote,
      excludedModes: ['rideshare'],
      sortPreference: 'cheapest',
      routing: { general: {}, mode: { transit: { transitBufferMinutes: 5 } } },
      speech: { rate: 1.5 },
      guidance: { cameraMode: 'north-up' },
    })
    await settle()
    expect(store.excludedModes).toEqual(['rideshare'])
    expect(store.sortPreference).toBe('cheapest')
    expect(store.transitBufferMinutes).toBe(5)
    expect(store.speech).toEqual({ rate: 1.5, voices: {} })
    expect(store.guidance.cameraMode).toBe('north-up')
    expect(save).not.toHaveBeenCalled()
  })

  it('seeds the account with device values it never saved', async () => {
    const store = useNavigationPreferencesStore()
    store.setModePreference('walking', 'hills', 0)
    store.adopt({ ...remote, speech: { rate: 1 } })
    await settle()
    expect(save).toHaveBeenCalledOnce()
    const patch = save.mock.calls[0][0] as any
    expect(Object.keys(patch).sort()).toEqual(['guidance', 'routing'])
    expect(patch.routing.mode.walking.hills).toBe(0)
  })

  it('batches changes into one save per section', async () => {
    const store = useNavigationPreferencesStore()
    store.adopt({ ...remote, routing: { general: {}, mode: {} }, speech: {}, guidance: {} })
    store.setModeEnabled('driving', false)
    store.setModeEnabled('transit', false)
    store.speech.rate = 1.25
    await settle()
    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith({
      excludedModes: ['transit', 'driving'],
      speech: { rate: 1.25, voices: {} },
    })
  })

  it('retries a failed save with the next change', async () => {
    const store = useNavigationPreferencesStore()
    store.adopt({ ...remote, routing: { general: {}, mode: {} }, speech: {}, guidance: {} })
    save.mockRejectedValueOnce(new Error('offline'))
    store.setModeEnabled('driving', false)
    await settle()
    store.sortPreference = 'greenest'
    await settle()
    expect(save).toHaveBeenLastCalledWith({ excludedModes: ['driving'], sortPreference: 'greenest' })
  })

  it('stops saving once signed out', async () => {
    const store = useNavigationPreferencesStore()
    const auth = useAuthStore()
    auth.me = { id: 'user-1' } as any
    store.adopt({ ...remote, routing: { general: {}, mode: {} }, speech: {}, guidance: {} })
    auth.me = null
    await nextTick()
    store.setModeEnabled('driving', false)
    await settle()
    expect(save).not.toHaveBeenCalled()
  })
})
