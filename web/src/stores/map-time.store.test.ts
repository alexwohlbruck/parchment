import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { reactive, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

const groups = reactive<{ id: string; visible: boolean }[]>([])
const appearances = reactive<Record<string, string>>({})

vi.mock('@/stores/layers.store', () => ({
  useLayersStore: () => ({ get allLayerGroups() { return groups } }),
}))
vi.mock('@/stores/layer-appearance.store', () => ({
  useLayerAppearanceStore: () => ({ appearanceOf: (id: string) => (appearances[id] ? { id: appearances[id] } : undefined) }),
}))

const { useMapTimeStore } = await import('./map-time.store')
const { isMapTimeLive, mapTime, setMapTime } = await import('@/services/map/map-time.service')

describe('useMapTimeStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 17, 9, 41))
    groups.splice(0, groups.length)
    setActivePinia(createPinia())
  })

  afterEach(() => {
    setMapTime(null)
    vi.useRealTimers()
  })

  test('is shown only while a temporal layer reads the time', async () => {
    const store = useMapTimeStore()
    expect(store.active).toBe(false)
    groups.push({ id: 'default:group:transit', visible: true }, { id: 'default:group:daynight', visible: true })
    appearances['default:group:transit'] = 'full-service'
    expect(store.activeLayerIds).toEqual(['default:group:daynight'])
    groups[1].visible = false
    expect(store.active).toBe(false)
  })

  test('a chosen time pins every temporal layer and Now releases it', async () => {
    const store = useMapTimeStore()
    store.setFixedTime(5, 22 * 60 + 30)
    await nextTick()
    expect(isMapTimeLive()).toBe(false)
    expect(mapTime().getDay()).toBe(6)
    expect(mapTime().getHours()).toBe(22)
    store.goLive()
    await nextTick()
    expect(isMapTimeLive()).toBe(true)
  })

  test('follows the clock each minute while live and a temporal layer is on', async () => {
    groups.push({ id: 'default:group:daynight', visible: true })
    const store = useMapTimeStore()
    vi.advanceTimersByTime(60_000)
    expect(store.displayMinutes).toBe(9 * 60 + 42)
  })
})
