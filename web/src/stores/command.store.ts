import { defineStore } from 'pinia'
import { computed, markRaw, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Command } from '@/types/command.types'
import { Locale } from '@/lib/i18n'
import {
  ChevronsRightIcon,
  CogIcon,
  DraftingCompassIcon,
  HelpCircleIcon,
  LanguagesIcon,
  LogOutIcon,
  MapPinIcon,
  PaletteIcon,
  SearchIcon,
  SunMoonIcon,
  TerminalIcon,
} from 'lucide-vue-next'
import { useDark, useToggle } from '@vueuse/core'
import {
  allColors,
  useThemeStore,
  allRadii,
} from '@/stores/settings/theme.store'
import { useMapService } from '@/services/map.service'

import ColorCommandArgumentOption from '@/components/palette/custom-items/ColorCommandArgumentOption.vue'
import { useI18n } from 'vue-i18n'
import { useAuthService } from '@/services/auth.service'

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

export const useCommandStore = defineStore('command', () => {
  const isDark = useDark()
  const toggleDark = useToggle(isDark)
  const router = useRouter()
  const { setAccentColor, setRadius } = useThemeStore()
  const authService = useAuthService()
  const mapService = useMapService()
  const { t, locale } = useI18n()

  function bindCommandToFunction(id: string, action: Function) {
    const command = commands.value.find(c => c.id === id)
    if (command) {
      command.action = action
    }
  }

  const commands = computed<Command[]>(() => {
    return [
      {
        id: 'openPalette',
        name: t('palette.commands.openPalette.name'),
        description: t('palette.commands.openPalette.description'),
        hotkey: ['mod', 'k'],
        icon: TerminalIcon,
      },
      {
        id: 'search',
        name: t('palette.commands.search.name'),
        description: t('palette.commands.search.description'),
        hotkey: ['/'],
        icon: SearchIcon,
        keywords: t('palette.commands.search.keywords'),
        action: (query: string) => {
          console.log('Search:', query)
        },
        arguments: [
          {
            id: 'places',
            name: t('palette.commands.search.arguments.places.name'),
            type: 'string',
            getItems() {
              return places.map(place => ({
                value: place.name,
                name: place.name,
                description: place.address,
                icon: MapPinIcon,
              }))
            },
          },
        ],
      },
      {
        id: 'goto',
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
        id: 'toggleTheme',
        name: t('palette.commands.toggleTheme.name'),
        description: t('palette.commands.toggleTheme.description'),
        icon: SunMoonIcon,
        keywords: t('palette.commands.toggleTheme.keywords'),
        hotkey: ['t'],
        action: toggleDark,
      },
      {
        id: 'updateThemeColor',
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
            customItemComponent: markRaw(ColorCommandArgumentOption),
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
        id: 'updateThemeRadius',
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
        id: 'chooseMapLibrary',
        name: t('palette.commands.chooseMapLibrary.name'),
        description: t('palette.commands.chooseMapLibrary.description'),
        icon: CogIcon,
        hotkey: ['l'],
        action: mapService.setMapLibrary,
        arguments: [
          {
            id: 'library',
            name: t('palette.commands.chooseMapLibrary.arguments.library.name'),
            type: 'string',
            getItems() {
              return [
                {
                  value: 'mapbox',
                  name: t(
                    'palette.commands.chooseMapLibrary.arguments.library.values.mapbox.name',
                  ),
                  description: t(
                    'palette.commands.chooseMapLibrary.arguments.library.values.mapbox.description',
                  ),
                },
                {
                  value: 'maplibre',
                  name: t(
                    'palette.commands.chooseMapLibrary.arguments.library.values.maplibre.name',
                  ),
                  description: t(
                    'palette.commands.chooseMapLibrary.arguments.library.values.maplibre.description',
                  ),
                },
              ]
            },
          },
        ],
      },
      {
        id: 'openHotkeysMenu',
        name: t('palette.commands.openHotkeysMenu.name'),
        description: t('palette.commands.openHotkeysMenu.description'),
        keywords: t('palette.commands.openHotkeysMenu.keywords'),
        hotkey: ['s'],
        icon: HelpCircleIcon,
      },
      {
        id: 'updateLanguage',
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
        id: 'signOut',
        name: t('palette.commands.signOut.name'),
        description: t('palette.commands.signOut.description'),
        keywords: t('palette.commands.signOut.keywords'),
        icon: LogOutIcon,
        action: authService.signOut,
      },
    ]
  })

  return {
    bindCommandToFunction,
    commands,
  }
})
