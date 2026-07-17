import { defineStore, storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Command, CommandArgumentOption } from '@/types/command.types'
import { Locale } from '@/lib/i18n'
import { getPlaceRoute } from '@/lib/place.utils'
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
import { useMapService } from '@/services/map.service'

import { useI18n } from 'vue-i18n'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import { MapEngine, MapProjection } from '@/types/map.types'
import { useSearchService } from '@/services/search.service'
import { useCommandService } from '@/services/command.service'
import { getCategoryColor } from '@/lib/place-colors'
import type { PlaceCategory } from '@/types/place.types'
import { useCategoryStore } from '@/stores/category.store'
import { useRecentsStore } from '@/stores/recents.store'
import type { RecentSearchEntry, RecentPlaceEntry } from '@/lib/recents'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { getBookmarkPlaceId } from '@/lib/place.utils'
import { frequentChipMeta } from '@/lib/frequents'
import { COMMON_CATEGORIES } from '@/lib/common-categories'
import { appEventBus } from '@/lib/eventBus'

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
            const category = categoryStore.getCategoryById(categoryId)
            await router.push({
              name: AppRoute.SEARCH_RESULTS,
              query: {
                categoryId,
                ...(category?.name ? { categoryName: category.name } : {}),
                ...(category?.iconCategory ? { categoryIconCategory: category.iconCategory } : {}),
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
          } else {
            // Regular place navigation
            const route = getPlaceRoute(itemId)
            router.push(route)
          }
        },
        arguments: [
          {
            id: 'places',
            name: t('palette.commands.search.arguments.places.name'),
            type: 'string',
            async getItems(_query?: string, signal?: AbortSignal) {
              // Use the command service to get the current search query
              const { currentSearchQuery } = useCommandService()
              const searchText = currentSearchQuery.value

              // Recent searches + places (client-side, end-to-end encrypted).
              // They surface in a dedicated "Recents" section, deduped from the
              // live result groups so the same entity never appears twice.
              // Hydration is a no-op after the first load.
              const recentsStore = useRecentsStore()
              const q = searchText.trim().toLowerCase()

              // A recent, ready to render, plus the metadata used to order and
              // dedupe it: `at` (recency) and `identity` (stable entity key).
              type RecentEntry = {
                option: CommandArgumentOption
                at: number
                identity: string
              }

              const recentSearchToEntry = (e: RecentSearchEntry): RecentEntry => {
                if (e.kind === 'category' && e.categoryId) {
                  return {
                    at: e.at,
                    identity: `category:${e.categoryId}`,
                    option: {
                      value: `category:${e.categoryId}`,
                      name: e.query,
                      iconName: e.iconName || 'MapPin',
                      iconPack: (e.iconPack || 'lucide') as 'lucide' | 'maki',
                      iconColor: getCategoryColor(
                        (e.iconCategory || 'default') as PlaceCategory,
                        isDark.value,
                      ),
                      group: 'recents',
                    },
                  }
                }
                if (e.kind === 'brand' && e.brandKey) {
                  return {
                    at: e.at,
                    identity: `brand:${e.brandKey}`,
                    option: {
                      value: `brand:${encodeURIComponent(
                        JSON.stringify({ key: e.brandKey, name: e.brandName || e.query }),
                      )}`,
                      name: e.query,
                      iconName: e.iconName || 'Store',
                      iconPack: (e.iconPack || 'lucide') as 'lucide' | 'maki',
                      iconColor: getCategoryColor('default', isDark.value),
                      imageUrl: e.brandLogoUrl,
                      group: 'recents',
                    },
                  }
                }
                return {
                  at: e.at,
                  identity: `text:${e.query.trim().toLowerCase()}`,
                  option: {
                    value: `recent-search:${e.query}`,
                    name: e.query,
                    iconName: 'History',
                    iconColor: getCategoryColor('default', isDark.value),
                    group: 'recents',
                  },
                }
              }

              const recentPlaceToEntry = (e: RecentPlaceEntry): RecentEntry => ({
                at: e.at,
                identity: `place:${e.id}`,
                option: {
                  value: e.id,
                  name: e.title,
                  description: e.subtitle,
                  iconName: e.icon || 'MapPin',
                  iconPack: (e.iconPack || 'lucide') as 'lucide' | 'maki',
                  iconColor: getCategoryColor(
                    (e.category || 'default') as PlaceCategory,
                    isDark.value,
                  ),
                  group: 'recents',
                },
              })

              // Merge every recent kind, keep the ones matching `predicate`,
              // order newest-first, and cap the section.
              const buildRecents = (
                predicate: (label: string) => boolean,
              ): RecentEntry[] =>
                [
                  ...recentsStore.searches
                    .filter(e => predicate(e.query))
                    .map(recentSearchToEntry),
                  ...recentsStore.places
                    .filter(e => predicate(e.title) || predicate(e.subtitle || ''))
                    .map(recentPlaceToEntry),
                ]
                  .sort((a, b) => b.at - a.at)
                  .slice(0, 8)

              // ── Empty query → frequents, common categories, recents. ──
              if (!q) {
                await Promise.all([
                  recentsStore.ensureSearchesHydrated(),
                  recentsStore.ensurePlacesHydrated(),
                ])

                // Frequents: Home / Work / School / custom, rendered as tiles.
                const bookmarksStore = useBookmarksStore()
                const frequentItems = bookmarksStore.bookmarks
                  .filter(b => b.frequentType)
                  .slice(0, 8)
                  .map(b => {
                    const meta = frequentChipMeta(b)
                    return {
                      value: getBookmarkPlaceId(b) ?? '',
                      name: meta.labelKey ? t(meta.labelKey) : meta.title ?? b.name,
                      description: b.address || undefined,
                      iconName: meta.icon,
                      iconPack: meta.iconPack,
                      color: meta.color,
                      group: 'frequents',
                    }
                  })
                  .filter(item => item.value)

                const recentEntries = buildRecents(() => true)

                // Common categories: a fixed, curated set of browse shortcuts.
                // Always shown in full — it's a stable menu, so using one doesn't
                // make it disappear (it may also appear under Recents, which is
                // fine: the menu and your history mean different things).
                const suggestedCategoryItems = COMMON_CATEGORIES.map(c => ({
                  value: `category:${c.id}`,
                  name: t(c.labelKey),
                  iconName: c.icon,
                  iconPack: 'lucide' as const,
                  iconColor: getCategoryColor(c.category, isDark.value),
                  group: 'suggestedCategories',
                }))

                return [
                  ...frequentItems,
                  ...suggestedCategoryItems,
                  ...recentEntries.map(r => r.option),
                ]
              }

              // ── Typed query → server autocomplete + matching recents. ──
              await Promise.all([
                recentsStore.ensureSearchesHydrated(),
                recentsStore.ensurePlacesHydrated(),
              ])

              // Matching recents → their own section; also used to dedupe the
              // same entity out of the live brands/categories/places groups.
              const recentEntries = buildRecents(label => {
                const l = label.toLowerCase()
                return l.includes(q) && l !== q
              })
              const recentIdentities = new Set(recentEntries.map(r => r.identity))
              const recentItems = recentEntries.map(r => r.option)

              const fullSearchItem = searchText.trim()
                ? [
                    {
                      value: 'search-more-results',
                      name: searchText,
                      iconName: 'Search',
                      iconColor: getCategoryColor('default', isDark.value),
                      group: 'fullSearch',
                    },
                  ]
                : []

              try {
                // Get map center for location-aware search
                const mapStore = useMapStore()
                const center = mapStore.mapCamera.center

                let lng, lat
                if (Array.isArray(center)) {
                  ;[lng, lat] = center
                } else if (typeof center === 'object') {
                  lng =
                    'lng' in center
                      ? center.lng
                      : 'lon' in center
                      ? center.lon
                      : 0
                  lat = center.lat || 0
                }

                // The server returns categories and places interleaved by relevance score.
                // Trust the server's ordering — no client-side category search or re-sort.
                const searchResults =
                  await placeSearchService.getAutocompleteSuggestions({
                    query: searchText,
                    lat,
                    lng,
                  }, signal)
                const results = searchResults
                  .map(result => {
                    // Brand suggestion ("See all McDonald's locations"): encode the
                    // key + name so the action can browse it; own group + icon.
                    if (result.type === 'brand' && result.brand) {
                      const payload = encodeURIComponent(
                        JSON.stringify({ key: result.brand.brandKey, name: result.brand.name }),
                      )
                      return {
                        identity: `brand:${result.brand.brandKey}`,
                        option: {
                          value: `brand:${payload}`,
                          name: result.title,
                          description: result.brand.locationCount != null
                            ? t('palette.commands.search.brand.locationsCount', { count: result.brand.locationCount })
                            : t('palette.commands.search.brand.seeAll'),
                          iconName: result.icon || 'Store',
                          iconPack: (result.iconPack || 'lucide') as 'lucide' | 'maki',
                          iconColor: getCategoryColor('default', isDark.value),
                          imageUrl: result.brand.logoUrl,
                          group: 'brands',
                        },
                      }
                    }

                    const itemValue = result.type === 'category'
                      ? `category:${result.id}`
                      : result.id
                    const iconCategory = (result.iconCategory || 'default') as PlaceCategory
                    return {
                      identity:
                        result.type === 'category'
                          ? `category:${result.id}`
                          : `place:${result.id}`,
                      option: {
                        value: itemValue,
                        name: result.title,
                        description: result.description && !/^\S+=\S+$/.test(result.description)
                          ? result.description
                          : undefined,
                        iconName: result.icon || 'MapPin',
                        iconPack: result.iconPack || 'lucide',
                        iconColor: getCategoryColor(iconCategory, isDark.value),
                        group: result.type === 'category' ? 'categories' : 'places',
                      },
                    }
                  })
                  // Drop live results already surfaced in the Recents section.
                  .filter(r => !recentIdentities.has(r.identity))
                  .map(r => r.option)

                return [...fullSearchItem, ...recentItems, ...results]
              } catch (error) {
                console.error('Error loading search suggestions:', error)
                // Still surface recents even when the server search fails.
                return [...fullSearchItem, ...recentItems]
              }
            },
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
        engine: [MapEngine.MAPBOX],
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
              return Object.values(MapProjection).map(projection => ({
                value: projection,
                name: t(
                  `palette.commands.mapProjection.arguments.projection.values.${projection}`,
                ),
              }))
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
