import { defineStore } from 'pinia'
import type { AppPreferences } from '@server/types/app-preferences.types'
import { isBoolean, isStringArray, oneOf, pickKnown, pickValid, type Validators } from '@/lib/preferences/setting-validators'
import { POI_STYLES } from '@/lib/map-style/build'
import { saveAppPreferences } from '@/services/preferences.service'
import { useAppStore, type HomeSheetStart } from '@/stores/app.store'
import { useLayerAppearanceStore } from '@/stores/layer-appearance.store'
import { useMapStore } from '@/stores/map.store'
import { allColors, allRadii, colorSchemes, uiThemes, useThemeStore, type ColorScheme, type UiTheme } from '@/stores/theme.store'
import {
  BASEMAPS,
  ENGINE_PROJECTIONS,
  FloorNumbering,
  GridSnapMode,
  LocateFlySpeed,
  MAP_STYLE_IDS,
  MapProjection,
  StartupLocation,
  type MapSettings,
} from '@/types/map.types'
import { useAccountSync } from './account-sync'

interface ThemeSettings {
  accentColor: string
  radius: number
  colorScheme: ColorScheme
  uiTheme: UiTheme
}

interface GeneralSettings {
  floorNumbering: FloorNumbering
  homeSheetStart: HomeSheetStart
}

/** Map settings that suit any device. Engine, 3D and shadows depend on what the device can draw, so they stay on it. */
type SyncedMapSettings = Pick<
  MapSettings,
  | 'basemap'
  | 'mapStyle'
  | 'poiStyle'
  | 'projection'
  | 'poiLabels'
  | 'roadLabels'
  | 'transitLabels'
  | 'placeLabels'
  | 'indoorMaps'
  | 'northUpSnap'
  | 'gridSnapMode'
  | 'locateFlySpeed'
  | 'startupLocation'
  | 'satelliteImagery'
>

const THEME: Validators<ThemeSettings> = {
  accentColor: oneOf<string>(allColors),
  radius: oneOf(allRadii),
  colorScheme: oneOf(colorSchemes),
  uiTheme: oneOf(uiThemes),
}

const GENERAL: Validators<GeneralSettings> = {
  floorNumbering: oneOf(Object.values(FloorNumbering)),
  homeSheetStart: oneOf(['search', 'library']),
}

const MAP: Validators<SyncedMapSettings> = {
  basemap: oneOf(BASEMAPS),
  mapStyle: oneOf(MAP_STYLE_IDS),
  poiStyle: oneOf(POI_STYLES),
  projection: oneOf(Object.values(MapProjection)),
  poiLabels: isBoolean,
  roadLabels: isBoolean,
  transitLabels: isBoolean,
  placeLabels: isBoolean,
  indoorMaps: isBoolean,
  northUpSnap: isBoolean,
  gridSnapMode: oneOf(Object.values(GridSnapMode)),
  locateFlySpeed: oneOf(Object.values(LocateFlySpeed)),
  startupLocation: oneOf(Object.values(StartupLocation)),
  satelliteImagery: isStringArray,
}

/** Look-and-feel settings that follow the account: theme, map, and a few app-wide choices. */
export const useAppPreferencesStore = defineStore('appPreferences', () => {
  const themeStore = useThemeStore()
  const mapStore = useMapStore()
  const appStore = useAppStore()
  const layerAppearanceStore = useLayerAppearanceStore()

  const sync = useAccountSync<Required<AppPreferences>>(
    'app',
    {
      theme: () => pickKnown(THEME, themeStore),
      map: () => pickKnown(MAP, mapStore.ownSettings),
      general: () => pickKnown(GENERAL, appStore),
      layerAppearances: () => layerAppearanceStore.chosen,
    },
    saveAppPreferences,
  )

  function adoptMap(remote: unknown) {
    const map = pickValid(MAP, remote)
    // A projection the other device's engine drew may be one this engine can't.
    if (map.projection && !ENGINE_PROJECTIONS[mapStore.settings.engine].includes(map.projection)) {
      delete map.projection
    }
    mapStore.setOwnSettings(map)
  }

  function adopt(remote: AppPreferences) {
    sync.adopt(remote, values => {
      Object.assign(themeStore, pickValid(THEME, values.theme))
      Object.assign(appStore, pickValid(GENERAL, values.general))
      adoptMap(values.map)
      if (values.layerAppearances) {
        layerAppearanceStore
          .adopt(values.layerAppearances, mapStore.getMapStrategy())
          .catch(error => console.error('[preferences] layer appearances failed to apply', error))
      }
    })
  }

  return { adopt }
})
