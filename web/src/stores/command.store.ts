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
  MapPinIcon,
  PaletteIcon,
  SearchIcon,
  SettingsIcon,
  SunMoonIcon,
  TerminalIcon,
} from 'lucide-vue-next'
import * as LucideIcons from 'lucide-vue-next'
import { useDark, useToggle } from '@vueuse/core'
import { allColors, useThemeStore, allRadii } from '@/stores/theme.store'
import { useMapStore } from '@/stores/map.store'
import { useMapService } from '@/services/map.service'

import { useI18n } from 'vue-i18n'
import { useAuthService } from '@/services/auth.service'
import { MapEngine, MapProjection } from '@/types/map.types'
import { useSearchService } from '@/services/search.service'
import { useCommandService } from '@/services/command.service'
import { useCategoryStore } from '@/stores/category.store'

import { formatAddress } from '@/lib/place.utils'
import { Icon } from '@/types/app.types'
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
  OPEN_SETTINGS = 'openSettings',
  UPDATE_LANGUAGE = 'updateLanguage',
  SIGN_OUT = 'signOut',
}

// TODO: Move command options to separate file

/**
 * Convert icon string name to Vue component
 */
function getIconComponent(iconName?: string): Icon {
  if (!iconName) return MapPinIcon

  const fullName = iconName.endsWith('Icon') ? iconName : `${iconName}Icon`

  const isValidIcon =
    fullName !== 'icons' &&
    typeof LucideIcons[fullName as keyof typeof LucideIcons] === 'function'

  return isValidIcon
    ? (LucideIcons[fullName as keyof typeof LucideIcons] as Icon)
    : MapPinIcon
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

            const category = categoryStore.getCategoryById(categoryId)
            if (category) {
              await router.push({
                name: AppRoute.SEARCH_RESULTS,
                query: {
                  categoryId: category.id,
                  categoryName: category.name,
                },
              })
            }
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
            async getItems() {
              // Use the command service to get the current search query
              const { currentSearchQuery } = useCommandService()
              const searchText = currentSearchQuery.value

              try {
                const results: any[] = []

                // First, search categories if we have a query and Overpass is available
                if (searchText && searchText.length > 0) {
                  const categoryStore = useCategoryStore()

                  if (categoryStore.isOverpassAvailable) {
                    const categories = categoryStore.searchCategories(
                      searchText,
                      5,
                    ) // Limit categories to 5

                    categories.forEach(category => {
                      results.push({
                        value: `category:${category.id}`,
                        name: category.name,
                        description: 'Category',
                        icon: getIconComponent(category.icon || 'Tag'),
                      })
                    })
                  }
                }

                // Then search places
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

                const searchResults =
                  await placeSearchService.getAutocompleteSuggestions({
                    query: searchText,
                    lat,
                    lng,
                  })

                // Add place results after categories (filter out category results to avoid duplicates)
                searchResults
                  .filter(result => result.type !== 'category')
                  .forEach(result => {
                    results.push({
                      value: result.id,
                      name: result.title,
                      description: result.description,
                      icon: getIconComponent(result.icon),
                    })
                  })

                return [
                  {
                    value: 'search-more-results',
                    name: `Search "${searchText}"`,
                    icon: SearchIcon,
                  },
                  ...results,
                ]
              } catch (error) {
                console.error('Error loading search suggestions:', error)
                return []
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
              return [
                {
                  value: 'mapbox',
                  name: t(
                    'palette.commands.chooseMapEngine.arguments.engine.values.mapbox.name',
                  ),
                  description: t(
                    'palette.commands.chooseMapEngine.arguments.engine.values.mapbox.description',
                  ),
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
      },
      {
        id: CommandName.OPEN_SETTINGS,
        name: t('palette.commands.openSettings.name'),
        description: t('palette.commands.openSettings.description'),
        keywords: t('palette.commands.openSettings.keywords'),
        hotkey: [','],
        icon: SettingsIcon,
        action: () => {
          const current = router.currentRoute.value
          if (current.matched.some(r => r.name === AppRoute.SETTINGS)) return

          router.push({ name: AppRoute.SETTINGS })
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
        action: authService.signOut,
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
