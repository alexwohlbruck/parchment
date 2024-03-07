import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Command } from '@/types/command.types'
import {
  ChevronsRightIcon,
  CogIcon,
  HelpCircleIcon,
  PaletteIcon,
  SearchIcon,
  SunMoonIcon,
} from 'lucide-vue-next'
import { useDark, useToggle } from '@vueuse/core'
import { useConfigStore } from '@/stores/settings.store'
import { useMapStore } from '@/stores/map.store'

export const useCommandStore = defineStore('command', () => {
  const isDark = useDark()
  const toggleDark = useToggle(isDark)
  const router = useRouter()
  const { setTheme } = useConfigStore()

  const commands = ref<Command[]>([
    {
      id: 'test',
      name: 'Test',
      icon: SearchIcon,
      action: (arg1, arg2) => {
        console.log(arg1, arg2)
      },
      hotkey: ['h'],
      arguments: [
        {
          name: 'Arg 1',
          type: 'string',
          getItems() {
            return [{ value: 'val1', name: 'Val 1' }]
          },
        },
        {
          name: 'Arg 2',
          type: 'string',
          getItems() {
            return [{ value: 'val2', name: 'Val 2' }]
          },
        },
      ],
    },
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
        setTheme(color as any)
      },
      arguments: [
        {
          name: 'Color',
          type: 'string',
          getItems() {
            // TODO: This get called for each item, should be called once
            return [
              {
                value: 'zinc',
                name: 'Zinc',
              },
              {
                value: 'red',
                name: 'Red',
              },
              {
                value: 'blue',
                name: 'Blue',
              },
            ]
          },
        },
      ],
    },
    {
      id: 'chooseMapLibrary',
      name: 'Choose map library',
      description: 'Change the library used to render the map',
      icon: CogIcon,
      action: (library: string) => {
        const mapStore = useMapStore()
        mapStore.setMapLibrary(library as any)
      },
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

  function bindCommandToFunction(id: string, action: Function) {
    const command = commands.value.find(c => c.id === id)
    if (command) {
      command.action = action
    }
  }

  return {
    commands,
    bindCommandToFunction,
  }
})
