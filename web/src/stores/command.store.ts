import { defineStore, storeToRefs } from 'pinia'
import { buildSearchSuggestions } from '@/services/search-suggestions.service'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Command, CommandArgumentOption } from '@/types/command.types'
import { Locale } from '@/lib/i18n'
import { getPlaceRoute, getTransitStopRoute } from '@/lib/place/place-route'
import {
  ensureStopIndexAt,
  osmForStop,
} from '@/services/layers/features/portolan/portolan-stops'
import {
  ChevronsRightIcon,
  CogIcon,
  DraftingCompassIcon,
  GlobeIcon,
  HelpCircleIcon,
  LanguagesIcon,
  LogOutIcon,
  PaletteIcon,
  SearchIcon,
  SettingsIcon,
  SunMoonIcon,
  TerminalIcon,
} from 'lucide-vue-next'
import { useDark, useToggle } from '@vueuse/core'
import { allColors, useThemeStore, allRadii } from '@/stores/theme.store'
import { useMapStore } from '@/stores/map.store'
import { useMapService } from '@/services/map/map.service'

import { useI18n } from 'vue-i18n'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import { ENGINE_PROJECTIONS, MapEngine } from '@/types/map.types'
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
  OPEN_HOTKEYS_MENU = 'openHotkeysMenu',
  UPDATE_LANGUAGE = 'updateLanguage',
  SIGN_OUT = 'signOut',
}

// TODO: Move command options to separate file


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
  const { settings } = storeToRefs(mapStore)

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
              const routes = router.getRoutes()
              return routes.map(route => {
                return {
                  value: route.name as string,
                  name: route.name as string,
                }
              })
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
