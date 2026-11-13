import { defineStore, storeToRefs } from 'pinia'
import { buildSearchSuggestions } from '@/services/search-suggestions.service'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Command, CommandArgumentOption } from '@/types/command.types'
import type { Icon } from '@/types/app.types'
import { Locale } from '@/lib/i18n'
import { getPlaceRoute, getTransitStopRoute } from '@/lib/place/place-route'
import {
  ensureStopIndexAt,
  osmForStop,
} from '@/services/layers/features/portolan/portolan-stops'
import {
  Building2Icon,
  ChevronsRightIcon,
  CogIcon,
  CompassIcon,
  DoorOpenIcon,
  Grid2x2Icon,
  CornerUpRightIcon,
  DraftingCompassIcon,
  FrameIcon,
  GlobeIcon,
  HelpCircleIcon,
  HistoryIcon,
  LanguagesIcon,
  LayersIcon,
  LayoutDashboardIcon,
  LibraryIcon,
  LogOutIcon,
  MapIcon,
  MapPinIcon,
  MountainSnowIcon,
  Move3dIcon,
  PaletteIcon,
  PanelsTopLeftIcon,
  RouteIcon,
  RulerIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  SunMoonIcon,
  TagIcon,
  TelescopeIcon,
  TerminalIcon,
  TreePineIcon,
} from 'lucide-vue-next'
import { useDark, useToggle } from '@vueuse/core'
import { allColors, useThemeStore, allRadii } from '@/stores/theme.store'
import { useMapStore } from '@/stores/map.store'
import { useAppStore } from '@/stores/app.store'
import { useMapService } from '@/services/map/map.service'

import { useI18n } from 'vue-i18n'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import {
  ControlVisibility,
  ENGINE_PROJECTIONS,
  GridSnapMode,
  MapEngine,
  ShadowMode,
  UnitSystem,
  type MapControlSettings,
  type PoiStyleId,
} from '@/types/map.types'
import { useSearchService } from '@/services/search.service'
import { useCommandService } from '@/services/command.service'
import { getCategoryColor } from '@/services/place/place-colors'
import type { PlaceCategory } from '@/types/place.types'
import { useCategoryStore } from '@/stores/category.store'
import { useRecentsStore } from '@/stores/recents.store'
import {
  recentPlaceIdentity,
  recentSearchIdentity,
  type RecentSearchEntry,
  type RecentPlaceEntry,
} from '@/lib/recents'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { getBookmarkPlaceId } from '@/lib/place/place-route'
import { frequentChipMeta } from '@/lib/frequents'
import { COMMON_CATEGORIES } from '@/lib/place/common-categories'
import { appEventBus } from '@/lib/event-bus'

import { AppRoute } from '@/router'
import ColorCommandArgumentOption from '@/components/palette/custom-items/ColorCommandArgumentOption.vue'

export enum CommandName {
  SEARCH = 'search',
  GOTO = 'goto',
  TOGGLE_THEME = 'toggleTheme',
  UPDATE_THEME_COLOR = 'updateThemeColor',
  UPDATE_THEME_RADIUS = 'updateThemeRadius',
  CHOOSE_MAP_ENGINE = 'chooseMapEngine',
  MAP_PROJECTION = 'mapProjection',
  TOGGLE_CAMERA_POSITION = 'toggleCameraPosition',
  OPEN_HOTKEYS_MENU = 'openHotkeysMenu',
  UPDATE_LANGUAGE = 'updateLanguage',
  TOGGLE_3D_BUILDINGS = 'toggle3dBuildings',
  TOGGLE_3D_TERRAIN = 'toggle3dTerrain',
  TOGGLE_3D_OBJECTS = 'toggle3dObjects',
  MAP_SHADOWS = 'mapShadows',
  TOGGLE_HD_ROADS = 'toggleHdRoads',
  TOGGLE_INDOOR_MAPS = 'toggleIndoorMaps',
  TOGGLE_MAP_LABELS = 'toggleMapLabels',
  TOGGLE_MAP_CONTROL = 'toggleMapControl',
  PLACE_ICON_STYLE = 'placeIconStyle',
  TOGGLE_NORTH_UP_SNAP = 'toggleNorthUpSnap',
  GRID_SNAP = 'gridSnap',
  UPDATE_UNIT_SYSTEM = 'updateUnitSystem',
  SIGN_OUT = 'signOut',
}

// TODO: Move command options to separate file

// Destinations that open without params. Individual settings pages are
// already searchable from the top-level palette. Built lazily because the
// router imports this store, so AppRoute is undefined at module load.
const gotoPages = (): {
  route: AppRoute
  key: string
  icon: Icon
  library?: boolean
}[] => [
  { route: AppRoute.MAP, key: 'map', icon: MapIcon },
  { route: AppRoute.DASHBOARD, key: 'dashboard', icon: LayoutDashboardIcon },
  { route: AppRoute.DIRECTIONS, key: 'directions', icon: CornerUpRightIcon },
  {
    route: AppRoute.LIBRARY_COLLECTIONS,
    key: 'collections',
    library: true,
    icon: LibraryIcon,
  },
  {
    route: AppRoute.LIBRARY_ROUTES,
    key: 'routes',
    library: true,
    icon: RouteIcon,
  },
  {
    route: AppRoute.LIBRARY_LAYERS,
    key: 'layers',
    library: true,
    icon: LayersIcon,
  },
  {
    route: AppRoute.LIBRARY_CANVASES,
    key: 'canvases',
    library: true,
    icon: FrameIcon,
  },
  { route: AppRoute.LOOKOUT, key: 'lookout', icon: TelescopeIcon },
  { route: AppRoute.TIMELINE, key: 'timeline', icon: HistoryIcon },
  { route: AppRoute.SETTINGS, key: 'settings', icon: SettingsIcon },
]

type MapLabel = 'poiLabels' | 'roadLabels' | 'transitLabels' | 'placeLabels'
const MAP_LABELS: MapLabel[] = ['poiLabels', 'roadLabels', 'transitLabels', 'placeLabels']

type MapControl = Exclude<keyof MapControlSettings, 'camera'>
const MAP_CONTROLS: MapControl[] = ['zoom', 'compass', 'scale', 'streetView', 'locate', 'weather']

const POI_STYLES: PoiStyleId[] = ['badge', 'glyph']

const GRID_SNAP_LABELS: Record<GridSnapMode, string> = {
  [GridSnapMode.OFF]: 'gridSnapModeOff',
  [GridSnapMode.NORTH_UP]: 'gridSnapModeNorthUp',
  [GridSnapMode.ALL]: 'gridSnapModeAll',
}

export const useCommandStore = defineStore('command', () => {
  const isDark = useDark()
  const toggleDark = useToggle(isDark)
  const router = useRouter()
  const { setAccentColor, setRadius } = useThemeStore()
  const authService = useAuthService()
  const mapService = useMapService()

  const { t, locale } = useI18n()
  const placeSearchService = useSearchService()

  const mapStore = useMapStore()
  const { settings, controlSettings } = storeToRefs(mapStore)
  const { unitSystem } = storeToRefs(useAppStore())

  const labelToggles: Record<MapLabel, () => void> = {
    poiLabels: mapService.togglePoiLabels,
    roadLabels: mapService.toggleRoadLabels,
    transitLabels: mapService.toggleTransitLabels,
    placeLabels: mapService.togglePlaceLabels,
  }

  function shownState(shown: boolean) {
    return t(`palette.toggleState.${shown ? 'shown' : 'hidden'}`)
  }

  function toggleCommand(
    id: CommandName,
    icon: Icon,
    action: () => void,
    engine?: MapEngine[],
  ): Command {
    return {
      id,
      name: t(`palette.commands.${id}.name`),
      description: t(`palette.commands.${id}.description`),
      keywords: t(`palette.commands.${id}.keywords`),
      icon,
      engine,
      action,
    }
  }

  function commandIsAvailable(command: Command) {
    // Check command is compatible with map engine
    if (!command.engine || command.engine?.includes(settings.value.engine)) {
      return true
    }

    return false
  }

  function getCommand(id: CommandName) {
    const command = commands.value.find(c => c.id === id)!

    if (commandIsAvailable(command)) {
      return command
    }

    return null
  }

  function useCommand(id: CommandName) {
    return computed(() => getCommand(id))
  }

  function getCommandArgumentOptions(
    commandId: CommandName,
    argumentId: string,
  ): CommandArgumentOption[] | undefined {
    const command = getCommand(commandId)
    if (!command) return

    const items = command.arguments
      ?.find(arg => arg.id === argumentId)
      ?.getItems()
    return items as CommandArgumentOption[]
  }

  const commands = computed<Command[]>(() => {
    return [
      {
        id: CommandName.SEARCH,
        name: t('palette.commands.search.name'),
        description: t('palette.commands.search.description'),
        hotkey: ['/'],
        icon: SearchIcon,
        keywords: t('palette.commands.search.keywords'),
        action: async (itemId: string) => {
          // Re-running a recent search — navigate; Search.vue records the
          // committed query (single choke-point for all text searches).
          if (
            typeof itemId === 'string' &&
            itemId.startsWith('recent-search:')
          ) {
            const q = itemId.slice('recent-search:'.length)
            router.push({
              name: AppRoute.SEARCH_RESULTS,
              query: { q },
            })
            return
          }

          if (itemId === 'search-more-results') {
            const { currentSearchQuery } = useCommandService()
            router.push({
              name: AppRoute.SEARCH_RESULTS,
              query: { q: currentSearchQuery.value },
            })
            return
          }

          if (itemId.startsWith('category:')) {
            const categoryId = itemId.replace('category:', '')
            const categoryStore = useCategoryStore()

            // Look up for optional enrichment (name, icon color), but navigate
            // regardless — categoryId alone is enough for Search.vue to work.
            // The curated list is the second source because the registry is
            // capped at 1000 presets and most everyday categories fall past it;
            // without this a shortcut lands on a title derived from its preset
            // id ("Wlan" for internet_access/wlan).
            const category = categoryStore.getCategoryById(categoryId)
            const common = COMMON_CATEGORIES.find(c => c.id === categoryId)
            const name = category?.name ?? (common ? t(common.labelKey) : undefined)
            const iconCategory = category?.iconCategory ?? common?.category
            await router.push({
              name: AppRoute.SEARCH_RESULTS,
              query: {
                categoryId,
                ...(name ? { categoryName: name } : {}),
                ...(iconCategory ? { categoryIconCategory: iconCategory } : {}),
              },
            })
          } else if (itemId.startsWith('brand:')) {
            // Payload carries the brand key + original-cased name (needed to
            // browse name-only brands, whose OSM tag value is case-sensitive).
            const payload = JSON.parse(
              decodeURIComponent(itemId.slice('brand:'.length)),
            )
            await router.push({
              name: AppRoute.SEARCH_RESULTS,
              query: {
                brandKey: payload.key,
                ...(payload.name ? { brandName: payload.name } : {}),
              },
            })
          } else if (itemId.startsWith('transit-stop:')) {
            // A GTFS-only stop. Barrelman already skipped stops portolan
            // matched to OSM, but the client-side index is re-checked here —
            // it may be fresher than the server's — before falling back to a
            // name+coords place view with the transit widget expanded.
            const payload = JSON.parse(
              decodeURIComponent(itemId.slice('transit-stop:'.length)),
            )
            await ensureStopIndexAt(payload.lat, payload.lng)
            const osm = osmForStop(
              payload.feedOnestopId,
              payload.stopId,
              payload.lat,
              payload.lng,
            )
            if (osm) {
              const [type, id] = osm.split('/')
              router.push({
                name: AppRoute.PLACE,
                params: { type, id },
                query: { complex: '1' },
              })
            } else {
              router.push(getTransitStopRoute(payload.name, payload.lat, payload.lng))
            }
          } else {
            // Regular place navigation (transit-route/ ids resolve to the
            // transit route detail view inside getPlaceRoute).
            const route = getPlaceRoute(itemId)
            router.push(route)
          }
        },
        arguments: [
          {
            id: 'places',
            name: t('palette.commands.search.arguments.places.name'),
            type: 'string',
            getItems: buildSearchSuggestions,
          },
        ],
      },
      {
        id: CommandName.GOTO,
        name: t('palette.commands.goto.name'),
        description: t('palette.commands.goto.description'),
        hotkey: ['mod', 'g'],
        icon: ChevronsRightIcon,
        action: (page: string) => {
          router.push({ name: page })
        },
        arguments: [
          {
            id: 'page',
            name: t('palette.commands.goto.arguments.page.name'),
            type: 'string',
            getItems() {
              return gotoPages().map(page => ({
                value: page.route,
                name: t(`palette.commands.goto.pages.${page.key}`),
                description: page.library ? t('library.title') : undefined,
                icon: page.icon,
              }))
            },
          },
        ],
      },
      {
        id: CommandName.TOGGLE_THEME,
        name: t('palette.commands.toggleTheme.name'),
        description: t('palette.commands.toggleTheme.description'),
        icon: SunMoonIcon,
        keywords: t('palette.commands.toggleTheme.keywords'),
        hotkey: ['t'],
        action: toggleDark,
      },
      {
        id: CommandName.UPDATE_THEME_COLOR,
        name: t('palette.commands.updateThemeColor.name'),
        description: t('palette.commands.updateThemeColor.description'),
        icon: PaletteIcon,
        keywords: t('palette.commands.updateThemeColor.keywords'),
        action: (color: string) => {
          setAccentColor(color as any)
        },
        arguments: [
          {
            id: 'color',
            name: t('palette.commands.updateThemeColor.arguments.color.name'),
            type: 'string',
            customItemComponent: ColorCommandArgumentOption,
            getItems() {
              // TODO: This get called for each item, should be called once
              return allColors.map(color => ({
                value: color,
                name: t(`settings.appearance.appTheme.color.values.${color}`),
              }))
            },
          },
        ],
      },
      {
        id: CommandName.UPDATE_THEME_RADIUS,
        name: t('palette.commands.updateThemeRadius.name'),
        description: t('palette.commands.updateThemeRadius.description'),
        icon: DraftingCompassIcon,
        action: (radius: number) => {
          setRadius(radius)
        },
        arguments: [
          {
            id: 'radius',
            name: t('palette.commands.updateThemeRadius.arguments.radius.name'),
            type: 'number',
            getItems() {
              return allRadii.map(radius => ({
                value: radius,
                name: `${radius} rem`,
              }))
            },
          },
        ],
      },
      {
        id: CommandName.CHOOSE_MAP_ENGINE,
        name: t('palette.commands.chooseMapEngine.name'),
        description: t('palette.commands.chooseMapEngine.description'),
        icon: CogIcon,
        hotkey: ['e'],
        action: mapService.setMapEngine,
        arguments: [
          {
            id: 'engine',
            name: t('palette.commands.chooseMapEngine.arguments.engine.name'),
            type: 'string',
            getItems() {
              const canUseMapbox = authService.hasPermission(PermissionId.PREMIUM_LAYERS)
              return [
                {
                  value: 'mapbox' as const,
                  name: t(
                    'palette.commands.chooseMapEngine.arguments.engine.values.mapbox.name',
                  ),
                  description: t(
                    'palette.commands.chooseMapEngine.arguments.engine.values.mapbox.description',
                  ),
                  premium: !canUseMapbox,
                },
                {
                  value: 'maplibre',
                  name: t(
                    'palette.commands.chooseMapEngine.arguments.engine.values.maplibre.name',
                  ),
                  description: t(
                    'palette.commands.chooseMapEngine.arguments.engine.values.maplibre.description',
                  ),
                },
              ]
            },
          },
        ],
      },
      {
        id: CommandName.MAP_PROJECTION,
        name: t('palette.commands.mapProjection.name'),
        description: t('palette.commands.mapProjection.description'),
        icon: GlobeIcon,
        hotkey: ['p'],
        action: mapService.setMapProjection,
        arguments: [
          {
            id: 'projection',
            name: t('palette.commands.mapProjection.arguments.projection.name'),
            type: 'string',
            getItems() {
              // Both engines project, but not into the same set of shapes.
              return ENGINE_PROJECTIONS[settings.value.engine].map(
                projection => ({
                  value: projection,
                  name: t(
                    `palette.commands.mapProjection.arguments.projection.values.${projection}`,
                  ),
                }),
              )
            },
          },
        ],
      },
      {
        id: CommandName.TOGGLE_CAMERA_POSITION,
        name: t('palette.commands.toggleCameraPosition.name'),
        description: t('palette.commands.toggleCameraPosition.description'),
        keywords: t('palette.commands.toggleCameraPosition.keywords'),
        icon: Move3dIcon,
        hotkey: ['c'],
        action: () => {
          controlSettings.value.camera =
            controlSettings.value.camera === ControlVisibility.ALWAYS
              ? ControlVisibility.NEVER
              : ControlVisibility.ALWAYS
        },
      },
      {
        id: CommandName.OPEN_HOTKEYS_MENU,
        name: t('palette.commands.openHotkeysMenu.name'),
        description: t('palette.commands.openHotkeysMenu.description'),
        keywords: t('palette.commands.openHotkeysMenu.keywords'),
        hotkey: ['h'],
        icon: HelpCircleIcon,
        action: () => {
          appEventBus.emit('hotkeys:open')
        },
      },
      {
        id: CommandName.UPDATE_LANGUAGE,
        name: t('palette.commands.updateLanguage.name'),
        description: t('palette.commands.updateLanguage.description'),
        keywords: t('palette.commands.updateLanguage.keywords'),
        icon: LanguagesIcon,
        action: (language: Locale) => {
          locale.value = language
        },
        arguments: [
          {
            id: 'language',
            name: t('palette.commands.updateLanguage.arguments.language.name'),
            type: 'string',
            getItems(): { value: Locale; name: string }[] {
              return [
                {
                  value: 'en-US',
                  name: 'English',
                },
                {
                  value: 'es-ES',
                  name: 'Español',
                },
              ]
            },
          },
        ],
      },
      toggleCommand(
        CommandName.TOGGLE_3D_BUILDINGS,
        Building2Icon,
        () => mapService.toggle3dBuildings(),
      ),
      toggleCommand(
        CommandName.TOGGLE_3D_TERRAIN,
        MountainSnowIcon,
        () => mapService.toggle3dTerrain(),
      ),
      toggleCommand(
        CommandName.TOGGLE_3D_OBJECTS,
        TreePineIcon,
        () => mapService.toggle3dObjects(),
        [MapEngine.MAPLIBRE],
      ),
      {
        id: CommandName.MAP_SHADOWS,
        name: t('palette.commands.mapShadows.name'),
        description: t('palette.commands.mapShadows.description'),
        keywords: t('palette.commands.mapShadows.keywords'),
        icon: SunIcon,
        engine: [MapEngine.MAPLIBRE],
        action: (mode: ShadowMode) => {
          settings.value.shadows = mode
        },
        arguments: [
          {
            id: 'mode',
            name: t('palette.commands.mapShadows.arguments.mode.name'),
            type: 'string',
            getItems() {
              return Object.values(ShadowMode).map(mode => ({
                value: mode,
                name: t(`settings.mapSettings.configuration.shadows.values.${mode}`),
              }))
            },
          },
        ],
      },
      toggleCommand(
        CommandName.TOGGLE_HD_ROADS,
        RouteIcon,
        () => mapService.toggleHdRoads(),
      ),
      toggleCommand(
        CommandName.TOGGLE_INDOOR_MAPS,
        DoorOpenIcon,
        () => mapService.toggleIndoorMaps(),
        [MapEngine.MAPBOX],
      ),
      {
        id: CommandName.TOGGLE_MAP_LABELS,
        name: t('palette.commands.toggleMapLabels.name'),
        description: t('palette.commands.toggleMapLabels.description'),
        keywords: t('palette.commands.toggleMapLabels.keywords'),
        icon: TagIcon,
        action: (label: MapLabel) => labelToggles[label](),
        arguments: [
          {
            id: 'label',
            name: t('palette.commands.toggleMapLabels.arguments.label.name'),
            type: 'string',
            getItems() {
              return MAP_LABELS.map(label => ({
                value: label,
                name: t(`settings.mapSettings.configuration.${label}`),
                description: shownState(settings.value[label]),
              }))
            },
          },
        ],
      },
      {
        id: CommandName.TOGGLE_MAP_CONTROL,
        name: t('palette.commands.toggleMapControl.name'),
        description: t('palette.commands.toggleMapControl.description'),
        keywords: t('palette.commands.toggleMapControl.keywords'),
        icon: PanelsTopLeftIcon,
        action: (control: MapControl) => {
          controlSettings.value[control] =
            controlSettings.value[control] === ControlVisibility.NEVER
              ? ControlVisibility.ALWAYS
              : ControlVisibility.NEVER
        },
        arguments: [
          {
            id: 'control',
            name: t('palette.commands.toggleMapControl.arguments.control.name'),
            type: 'string',
            getItems() {
              return MAP_CONTROLS.map(control => ({
                value: control,
                name: t(`settings.mapSettings.controls.${control}`),
                description: shownState(
                  controlSettings.value[control] !== ControlVisibility.NEVER,
                ),
              }))
            },
          },
        ],
      },
      {
        id: CommandName.PLACE_ICON_STYLE,
        name: t('palette.commands.placeIconStyle.name'),
        description: t('palette.commands.placeIconStyle.description'),
        keywords: t('palette.commands.placeIconStyle.keywords'),
        icon: MapPinIcon,
        engine: [MapEngine.MAPLIBRE],
        action: mapStore.setPoiStyle,
        arguments: [
          {
            id: 'style',
            name: t('palette.commands.placeIconStyle.arguments.style.name'),
            type: 'string',
            getItems() {
              return POI_STYLES.map(style => ({
                value: style,
                name: t(
                  `settings.mapSettings.style.poiStyle${style === 'badge' ? 'Badge' : 'Glyph'}`,
                ),
              }))
            },
          },
        ],
      },
      toggleCommand(
        CommandName.TOGGLE_NORTH_UP_SNAP,
        CompassIcon,
        () => mapService.toggleNorthUpSnap(),
      ),
      {
        id: CommandName.GRID_SNAP,
        name: t('palette.commands.gridSnap.name'),
        description: t('palette.commands.gridSnap.description'),
        keywords: t('palette.commands.gridSnap.keywords'),
        icon: Grid2x2Icon,
        action: (mode: GridSnapMode) => {
          settings.value.gridSnapMode = mode
        },
        arguments: [
          {
            id: 'mode',
            name: t('palette.commands.gridSnap.arguments.mode.name'),
            type: 'string',
            getItems() {
              return Object.values(GridSnapMode).map(mode => ({
                value: mode,
                name: t(`settings.mapSettings.rotation.${GRID_SNAP_LABELS[mode]}`),
              }))
            },
          },
        ],
      },
      {
        id: CommandName.UPDATE_UNIT_SYSTEM,
        name: t('palette.commands.updateUnitSystem.name'),
        description: t('palette.commands.updateUnitSystem.description'),
        keywords: t('palette.commands.updateUnitSystem.keywords'),
        icon: RulerIcon,
        action: (system: UnitSystem) => {
          unitSystem.value = system
        },
        arguments: [
          {
            id: 'units',
            name: t('palette.commands.updateUnitSystem.arguments.units.name'),
            type: 'string',
            getItems() {
              return Object.values(UnitSystem).map(system => ({
                value: system,
                name: t(`settings.behavior.units.${system}`),
              }))
            },
          },
        ],
      },
      {
        id: CommandName.SIGN_OUT,
        name: t('palette.commands.signOut.name'),
        description: t('palette.commands.signOut.description'),
        keywords: t('palette.commands.signOut.keywords'),
        icon: LogOutIcon,
        action: authService.confirmAndSignOut,
      },
    ]
  })

  return {
    commandIsAvailable,
    getCommand,
    useCommand,
    getCommandArgumentOptions,
    commands,
  }
})
