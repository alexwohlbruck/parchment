import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Command } from '@/types/command.types'
import {
  ChevronsRightIcon,
  CogIcon,
  DraftingCompassIcon,
  HelpCircleIcon,
  PaletteIcon,
  SearchIcon,
  SunMoonIcon,
} from 'lucide-vue-next'
import { useDark, useToggle } from '@vueuse/core'
import {
  allColors,
  useThemeStore,
  allRadii,
} from '@/stores/settings/theme.store'
import { useMapService } from '@/services/map.service'

export const useCommandStore = defineStore('command', () => {
  const isDark = useDark()
  const toggleDark = useToggle(isDark)
  const router = useRouter()
  const { setAccentColor, setRadius } = useThemeStore()
  const mapService = useMapService()

  function bindCommandToFunction(id: string, action: Function) {
    const command = commands.value.find(c => c.id === id)
    if (command) {
      command.action = action
    }
  }

  const commands = ref<Command[]>([
    {
      id: 'focusSearch',
      name: 'Search',
      description: 'Search for a location or run a command',
      hotkey: ['mod', 'k'],
      icon: SearchIcon,
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
      hotkey: ['t'],
      icon: SunMoonIcon,
      action: toggleDark,
    },
    {
      id: 'updateThemeColor',
      name: 'Update theme color',
      description: 'Change the color of the app theme',
      icon: PaletteIcon,
      action: (color: string) => {
        setAccentColor(color as any)
      },
      arguments: [
        {
          name: 'Color',
          type: 'string',
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
      hotkey: ['mod', 'shift', 'm'],
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
      description: 'View all available keyboard shortcuts',
      hotkey: ['s'],
      icon: HelpCircleIcon,
    },
  ])

  return {
    bindCommandToFunction,
    commands,
  }
})
