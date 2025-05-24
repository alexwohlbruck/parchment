import { defineStore, storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Command, CommandArgumentOption } from '@/types/command.types'
import { Locale } from '@/lib/i18n'
import { AppRoute } from '@/router'
import { getPlaceRoute } from '@/lib/place-utils'
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
  SunMoonIcon,
  TerminalIcon,
} from 'lucide-vue-next'
import { Place } from '../types/place.types'
import { useDark, useToggle } from '@vueuse/core'
import {
  allColors,
  useThemeStore,
  allRadii,
} from '@/stores/settings/theme.store'
import { useMapStore } from '@/stores/map.store'
import { useMapService } from '@/services/map.service'

import { useI18n } from 'vue-i18n'
import { useAuthService } from '@/services/auth.service'
import { MapEngine, MapProjection } from '@/types/map.types'
import { usePlaceSearchService } from '@/services/place-search.service'
import { useCommandService } from '@/services/command.service'

export enum CommandName {
  OPEN_PALETTE = 'openPalette',
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

// For testing purposes - to be removed once real search is implemented
const places = [
  {
    name: 'Viva Chicken',
    address: '1617 Elizabeth Ave, Charlotte, NC 28204',
    type: 'restaurant',
    distance: '0.2 mi',
  },
  {
    name: "The Workman's Friend",
    address: '1531 Central Ave, Charlotte, NC 28205',
    type: 'bar',
    distance: '0.3 mi',
  },
  {
    name: 'The Diamond',
    address: '1901 Commonwealth Ave, Charlotte, NC 28205',
    type: 'bar',
    distance: '0.4 mi',
  },
  {
    name: 'Sabor Latin Street Grill',
    address: '415 Hawthorne Ln, Charlotte, NC 28204',
    type: 'restaurant',
    distance: '0.5 mi',
  },
  {
    name: 'The Pizza Peel Plaza Midwood',
    address: '1600 Central Ave, Charlotte, NC 28205',
    type: 'restaurant',
    distance: '0.6 mi',
  },
]

// TODO: Move command options to separate file

export const useCommandStore = defineStore('command', () => {
  const isDark = useDark()
  const toggleDark = useToggle(isDark)
  const router = useRouter()
  const { setAccentColor, setRadius } = useThemeStore()
  const authService = useAuthService()
  const mapService = useMapService()
  const { t, locale } = useI18n()
  const placeSearchService = usePlaceSearchService()

  const { mapEngine } = storeToRefs(useMapStore())

  function commandIsAvailable(command: Command) {
    if (!command.engine || command.engine?.includes(mapEngine.value)) {
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

  function bindCommandToFunction(id: CommandName, action: Function) {
    const command = getCommand(id)
    if (command) {
      command.action = (...args: any[]) => {
        if (commandIsAvailable(command)) {
          action(...args)
        }
      }
    }
  }

  const commands = computed<Command[]>(() => {
    return [
      {
        id: CommandName.OPEN_PALETTE,
        name: t('palette.commands.openPalette.name'),
        description: t('palette.commands.openPalette.description'),
        hotkey: ['mod', 'k'],
        icon: TerminalIcon,
      },
      {
        id: CommandName.SEARCH,
        name: t('palette.commands.search.name'),
        description: t('palette.commands.search.description'),
        hotkey: ['/'],
        icon: SearchIcon,
        keywords: t('palette.commands.search.keywords'),
        action: (place: Place) => {
          if (Object.keys(place.externalIds).includes('osm')) {
            const route = getPlaceRoute(place.externalIds.osm)
            router.push(route)
          } else {
            const [provider, placeId] = Object.entries(place.externalIds)[0]
            router.push({
              name: AppRoute.PLACE_PROVIDER,
              params: {
                provider,
                placeId,
              },
            })
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

              if (!searchText || searchText.length < 2) {
                return []
              }

              try {
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

                const suggestions = await placeSearchService.getAutocomplete(
                  searchText,
                  lat,
                  lng,
                )

                if (suggestions.length === 0) {
                  return []
                }

                console.log(suggestions)

                return suggestions.map(place => ({
                  value: place,
                  name: place.name,
                  description:
                    place.address?.street1 || place.address?.formatted || '',
                  icon: MapPinIcon,
                }))
              } catch (error) {
                console.error('Error loading place suggestions:', error)
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
        hotkey: ['s'],
        icon: HelpCircleIcon,
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
    bindCommandToFunction,
    commands,
  }
})
