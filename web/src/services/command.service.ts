import { computed, ref, watch } from 'vue'
import mousetrap from 'mousetrap'
import { CommandName, useCommandStore } from '@/stores/command.store'
import { ArgumentType, Command } from '@/types/command.types'
import { type Command as TCommand } from '@/types/command.types'
import { createSharedComposable } from '@vueuse/core'
import { appEventBus } from '@/lib/event-bus'
import { useCommandUsageStore } from '@/stores/command-usage.store'

const activeCommand = ref<TCommand | null>(null)
const activeArgumentIndex = ref<number | null>(null)
const activeArgument = computed(() => {
  if (activeCommand.value && activeArgumentIndex.value !== null) {
    return activeCommand.value.arguments?.[activeArgumentIndex.value]
  }
  return null
})
const argumentsList = ref<ArgumentType[]>([])

function commandService() {
  const commandStore = useCommandStore()
  const usageStore = useCommandUsageStore()

  async function executeCommand(command: TCommand, ...args: ArgumentType[]) {
    if (!command.action) return

    activeCommand.value = command
    argumentsList.value.push(...args)
    activeArgumentIndex.value = (activeArgumentIndex.value ?? 0) + args.length

    const argsFilled = command.arguments
      ? activeArgumentIndex.value >= command.arguments.length
      : true

    if (argsFilled) {
      if (!command.context && command.id !== CommandName.SEARCH) {
        usageStore.record(command.id)
      }
      try {
        await command.action(...argumentsList.value)
      } catch (error) {
        console.error('Error executing command:', error)
      } finally {
        reset()
      }
    }
  }

  function reset() {
    activeCommand.value = null
    activeArgumentIndex.value = null
    argumentsList.value = []
  }

  function bindHotkeyToCommand(id: string) {
    const command = commandStore.useCommand(id)
    if (!command.value?.hotkey || !command.value?.action) return

    const bindingString = command.value.hotkey.join('+')

    mousetrap.bind(bindingString, e => {
      if (
        command.value &&
        command.value.action &&
        commandStore.commandIsAvailable(command.value)
      ) {
        e.preventDefault()
        executeCommand(command.value)
      }
    })
  }

  function bindAllHotkeysToCommands() {
    commandStore.commands.forEach(command => {
      bindHotkeyToCommand(command.id)
    })
  }

  function getHotkey(id: string) {
    const command = commandStore.commands.find(c => c.id === id)
    return command?.hotkey
  }

  // Function to update the search query in the command store
  const currentSearchQuery = ref('')
  function updateSearchQuery(query: string) {
    currentSearchQuery.value = query
    return query
  }

  // Watch for active argument changes and emit event to open palette
  watch(activeArgument, (newVal, prevVal) => {
    if (newVal) {
      appEventBus.emit('palette:open')
    }
  })

  return {
    executeCommand,
    activeCommand,
    activeArgumentIndex,
    activeArgument,
    argumentsList,
    reset,

    bindHotkeyToCommand,
    bindAllHotkeysToCommands,
    getHotkey,
    updateSearchQuery,
    currentSearchQuery,
  }
}

export const useCommandService = createSharedComposable(commandService)
