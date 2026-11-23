import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { AppPreferences } from '@server/types/app-preferences.types'
import { useAppPreferencesStore } from './app-preferences.store'
import { useAppStore } from '@/stores/app.store'
import { useMapStore } from '@/stores/map.store'
import { useThemeStore } from '@/stores/theme.store'
import { useDeviceOnlyStore } from './device-only.store'
import { FloorNumbering, MapProjection } from '@/types/map.types'

const save = vi.hoisted(() => vi.fn(async (_patch: AppPreferences) => {}))
vi.mock('@/services/preferences.service', () => ({ saveAppPreferences: save }))

const layerAppearances = vi.hoisted(() => ({ adopt: vi.fn(async () => {}) }))
vi.mock('@/stores/layer-appearance.store', () => ({
  useLayerAppearanceStore: () => ({ chosen: {}, adopt: layerAppearances.adopt }),
}))

const saved: AppPreferences = { theme: {}, map: {}, general: {}, layerAppearances: {} }

let pinia: Pinia

beforeEach(() => {
  localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
  save.mockClear()
  layerAppearances.adopt.mockClear()
  vi.useFakeTimers()
})
afterEach(() => {
  ;(pinia as any)._s.forEach((store: { $dispose(): void }) => store.$dispose())
  vi.useRealTimers()
})

async function settle() {
  await vi.runAllTimersAsync()
}

describe('app preferences store', () => {
  it('takes the account values without echoing them back', async () => {
    useAppPreferencesStore().adopt({
      theme: { accentColor: 'teal', radius: 1, colorScheme: 'dark', uiTheme: 'parchment' },
      map: { basemap: 'satellite', roadLabels: false },
      general: { floorNumbering: FloorNumbering.ONE_BASED, homeSheetStart: 'library' },
      layerAppearances: { 'default:group:cycling': 'suitability' },
    })
    await settle()

    const theme = useThemeStore()
    expect([theme.accentColor, theme.radius, theme.colorScheme, theme.uiTheme]).toEqual(['teal', 1, 'dark', 'parchment'])
    expect(document.documentElement.classList).toContain('ui-parchment')
    expect(useMapStore().settings).toMatchObject({ basemap: 'satellite', roadLabels: false })
    expect(useAppStore().floorNumbering).toBe(FloorNumbering.ONE_BASED)
    expect(useAppStore().homeSheetStart).toBe('library')
    expect(layerAppearances.adopt).toHaveBeenCalledWith({ 'default:group:cycling': 'suitability' }, undefined)
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps its own value where the account holds one it cannot use', async () => {
    useAppPreferencesStore().adopt({
      ...saved,
      theme: { accentColor: 'chartreuse', radius: 0.25 },
      map: { basemap: 'lunar', projection: MapProjection.ALBERS, placeLabels: false },
    })
    await settle()

    expect(useThemeStore().accentColor).toBe('parchment')
    expect(useThemeStore().radius).toBe(0.25)
    expect(useMapStore().settings).toMatchObject({
      basemap: 'standard',
      projection: MapProjection.GLOBE,
      placeLabels: false,
    })
  })

  it('saves a changed section whole, and only what suits any device', async () => {
    const mapStore = useMapStore()
    useAppPreferencesStore().adopt(saved)
    mapStore.settings.terrain3d = false
    await settle()
    expect(save).not.toHaveBeenCalled()

    mapStore.settings.basemap = 'hybrid'
    await settle()
    expect(save).toHaveBeenCalledOnce()
    const { map } = save.mock.calls[0][0]
    expect(map).toMatchObject({ basemap: 'hybrid', poiLabels: true })
    expect(map).not.toHaveProperty('terrain3d')
    expect(map).not.toHaveProperty('engine')
  })

  it('seeds the account with device values it never saved', async () => {
    useThemeStore().setAccentColor('cobalt')
    useAppPreferencesStore().adopt({ map: {}, layerAppearances: {} })
    await settle()

    expect(save).toHaveBeenCalledOnce()
    const patch = save.mock.calls[0][0]
    expect(Object.keys(patch).sort()).toEqual(['general', 'theme'])
    expect(patch.theme).toMatchObject({ accentColor: 'cobalt' })
  })

  it("leaves a canvas's map settings out of the account", async () => {
    const mapStore = useMapStore()
    const store = useAppPreferencesStore()
    store.adopt(saved)
    mapStore.parkedSettings = { roadLabels: true, placeLabels: true }
    mapStore.settings.roadLabels = false
    await settle()
    expect(save).not.toHaveBeenCalled()

    store.adopt({ ...saved, map: { placeLabels: false, basemap: 'satellite' } })
    expect(mapStore.parkedSettings.placeLabels).toBe(false)
    expect(mapStore.settings.placeLabels).toBe(true)
    expect(mapStore.settings.basemap).toBe('satellite')
  })

  describe('a setting kept on this device', () => {
    const theme = { accentColor: 'teal', radius: 0, colorScheme: 'auto', uiTheme: 'parchment' }

    beforeEach(() => useDeviceOnlyStore().setDeviceOnly('app.theme.radius', true))

    it('keeps its own value when adopting the account', async () => {
      useThemeStore().setRadius(0.75)
      useAppPreferencesStore().adopt({ ...saved, theme: { radius: 0, accentColor: 'teal' } })
      await settle()

      expect(useThemeStore().radius).toBe(0.75)
      expect(useThemeStore().accentColor).toBe('teal')
    })

    it("saves the account's value for it, not this device's", async () => {
      useAppPreferencesStore().adopt({ ...saved, theme })
      useThemeStore().setRadius(1)
      await settle()
      expect(save).not.toHaveBeenCalled()

      useThemeStore().setAccentColor('cobalt')
      await settle()
      expect(save.mock.calls[0][0].theme).toMatchObject({ radius: 0, accentColor: 'cobalt' })
    })

    it("sends this device's value once it syncs again", async () => {
      useAppPreferencesStore().adopt({ ...saved, theme })
      useThemeStore().setRadius(1)
      await settle()
      expect(save).not.toHaveBeenCalled()

      useDeviceOnlyStore().setDeviceOnly('app.theme.radius', false)
      await settle()
      expect(save.mock.calls[0][0].theme).toMatchObject({ radius: 1 })
    })
  })
})
