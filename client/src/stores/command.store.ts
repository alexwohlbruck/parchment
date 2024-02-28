import { defineStore } from 'pinia'
import { ref } from 'vue'
import { Command } from '@/types/command.types'
import { HelpCircleIcon, SearchIcon, SunMoonIcon } from 'lucide-vue-next'
import { useDark, useToggle } from '@vueuse/core'

const isDark = useDark()
const toggleDark = useToggle(isDark)

export const useCommandStore = defineStore('command', () => {
  const commands = ref<Command[]>([
    {
      id: 'focusSearch',
      name: 'Search',
      description: 'Search for a location or run a command',
      hotkey: ['mod', 'k'],
      icon: SearchIcon,
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
