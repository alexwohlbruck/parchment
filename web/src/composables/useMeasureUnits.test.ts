import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useMeasureUnits } from './useMeasureUnits'
import { UnitSystem } from '@/types/map.types'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale: ref('en-US') }) }))

const appState = { unitSystem: ref(UnitSystem.METRIC) }
vi.mock('@/stores/app.store', () => ({ useAppStore: () => appState }))
vi.mock('pinia', async importOriginal => ({
  ...(await importOriginal<typeof import('pinia')>()),
  storeToRefs: (store: never) => store,
}))

beforeEach(() => {
  setActivePinia(createPinia())
  appState.unitSystem.value = UnitSystem.METRIC
})

describe('useMeasureUnits', () => {
  it('starts from the app unit system', () => {
    expect(useMeasureUnits(ref(true)).system.value).toBe('metric')
    appState.unitSystem.value = UnitSystem.IMPERIAL
    expect(useMeasureUnits(ref(true)).system.value).toBe('imperial')
  })

  it('returns null for a zero measurement so callers can show a placeholder', () => {
    const { formatDistance, formatArea } = useMeasureUnits(ref(true))
    expect(formatDistance(0)).toBeNull()
    expect(formatArea(0)).toBeNull()
  })

  it('picks a unit to suit the magnitude until the user cycles', () => {
    const { formatDistance } = useMeasureUnits(ref(true))
    expect(formatDistance(5)).toContain('m')
    expect(formatDistance(50_000)).toContain('km')
  })

  it('cycling steps the unit and sticks', () => {
    const { formatDistance, cycleDistance } = useMeasureUnits(ref(true))
    const auto = formatDistance(50_000)
    cycleDistance(50_000)
    const cycled = formatDistance(50_000)
    expect(cycled).not.toBe(auto)
    // Still on the cycled unit, not back to automatic.
    expect(formatDistance(50_000)).toBe(cycled)
  })

  it('cycling wraps rather than running off the end of the list', () => {
    const { formatDistance, cycleDistance } = useMeasureUnits(ref(true))
    const seen = new Set<string>()
    for (let i = 0; i < 12; i++) {
      cycleDistance(1000)
      seen.add(formatDistance(1000)!)
    }
    // A finite set of units, revisited — never an undefined/NaN rendering.
    expect(seen.size).toBeGreaterThan(1)
    for (const value of seen) expect(value).not.toContain('undefined')
  })

  it('distance and area cycle independently', () => {
    const { formatArea, cycleDistance } = useMeasureUnits(ref(true))
    const before = formatArea(1_000_000)
    cycleDistance(1000)
    expect(formatArea(1_000_000)).toBe(before)
  })

  it('switching the panel unit system resets cycling to automatic', async () => {
    const { system, formatDistance, cycleDistance } = useMeasureUnits(ref(true))
    cycleDistance(50_000)
    const cycled = formatDistance(50_000)

    system.value = 'imperial'
    await nextTick()
    expect(formatDistance(50_000)).not.toBe(cycled)
    expect(formatDistance(50_000)).toMatch(/mi|ft/)
  })

  it('re-opening the panel returns to the app unit system and clears cycling', async () => {
    const isActive = ref(false)
    const { system, formatDistance, cycleDistance } = useMeasureUnits(isActive)

    system.value = 'imperial'
    cycleDistance(50_000)
    await nextTick()

    isActive.value = true
    await nextTick()
    expect(system.value).toBe('metric')
    expect(formatDistance(50_000)).toContain('km')
  })
})
