import { defineStore } from 'pinia'
import { markRaw, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Command } from '@/types/command.types'
import { Locale } from '@/lib/i18n'
import {
  ChevronsRightIcon,
  CogIcon,
  DraftingCompassIcon,
  HelpCircleIcon,
  LanguagesIcon,
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
  const mapService = useMapService()
  const { locale } = useI18n()

  function bindCommandToFunction(id: string, action: Function) {
    const command = commands.value.find(c => c.id === id)
    if (command) {
      command.action = action
    }
  }

  const commands = ref<Command[]>([
    {
      id: 'openPalette',
      name: 'Command palette',
      description: 'Run a command',
      hotkey: ['mod', 'k'],
      icon: TerminalIcon,
    },
    {
      id: 'search',
      name: 'Search places',
      description: 'Search for places, businesses, and amenities',
      hotkey: ['/'],
      icon: SearchIcon,
      keywords: ['find', 'locate'].join(),
      action: (query: string) => {
        console.log('Search:', query)
      },
      arguments: [
        {
          name: 'Places',
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
      name: 'Go to page',
      description: 'Navigate to a specific page in the app',
      hotkey: ['mod', 'g'],
      icon: ChevronsRightIcon,
      action: (page: string) => {
        router.push(page)
      },
      arguments: [
        {
          name: 'Page',
          type: 'string',
          getItems() {
            const routes = router.getRoutes()
            return routes.map(route => {
              return {
                value: route.path,
                name: route.name as string,
              }
            })
          },
        },
      ],
    },
    {
      id: 'toggleTheme',
      name: 'Toggle theme',
      description: 'Toggle between light and dark themes',
      keywords: ['mode', 'system'].join(),
      hotkey: ['t'],
      icon: SunMoonIcon,
      action: toggleDark,
    },
    {
      id: 'updateThemeColor',
      name: 'Update theme color',
      description: 'Change the color of the app theme',
      icon: PaletteIcon,
      keywords: ['accent', 'palette'].join(),
      action: (color: string) => {
        setAccentColor(color as any)
      },
      arguments: [
        {
          name: 'Color',
          type: 'string',
          customItemComponent: markRaw(ColorCommandArgumentOption),
          getItems() {
            // TODO: This get called for each item, should be called once
            return allColors.map(color => ({
              value: color,
              name: color.charAt(0).toUpperCase() + color.slice(1),
            }))
          },
        },
      ],
    },
    {
      id: 'updateThemeRadius',
      name: 'Update theme radius',
      description: 'Change the corner radius of the app theme',
      icon: DraftingCompassIcon,
      action: (radius: number) => {
        setRadius(radius)
      },
      arguments: [
        {
          name: 'Radius',
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
      name: 'Choose map library',
      description: 'Change the library used to render the map',
      icon: CogIcon,
      hotkey: ['l'],
      action: mapService.setMapLibrary,
      arguments: [
        {
          name: 'Map library',
          type: 'string',
          getItems() {
            return [
              {
                value: 'mapbox',
                name: 'Mapbox GL',
                description:
                  'A beautiful, detailed 3D map with dynamic lighting',
              },
              {
                value: 'maplibre',
                name: 'MapLibre GL',
                description:
                  'A fork of Mapbox GL v1 with an open-source license',
              },
            ]
          },
        },
      ],
    },
    {
      id: 'openHotkeysMenu',
      name: 'Keyboard shortcuts',
      keywords: ['help'].join(),
      description: 'View all available keyboard shortcuts',
      hotkey: ['s'],
      icon: HelpCircleIcon,
    },
    {
      id: 'updateLanguage',
      name: 'Change language',
      description: 'Change the language of the app',
      icon: LanguagesIcon,
      action: (language: Locale) => {
        locale.value = language
      },
      arguments: [
        {
          name: 'Language',
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
  ])

  return {
    bindCommandToFunction,
    commands,
  }
})
