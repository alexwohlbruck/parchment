import { computed, ref } from 'vue'
import mousetrap from 'mousetrap'
import { CommandName, useCommandStore } from '@/stores/command.store'
import { ArgumentType, Command } from '@/types/command.types'
import { type Command as TCommand } from '@/types/command.types'
import { createSharedComposable } from '@vueuse/core'

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

  async function executeCommand(command: TCommand, ...args: ArgumentType[]) {
    if (!command.action) return

    activeCommand.value = command
    argumentsList.value.push(...args)
    activeArgumentIndex.value = (activeArgumentIndex.value ?? 0) + args.length

    const argsFilled = command.arguments
      ? activeArgumentIndex.value >= command.arguments.length
      : true

    if (argsFilled) {
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

  function bindHotkeyToCommand(id: CommandName) {
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

  function bindCommandToFunction(id: CommandName, f: Function) {
    const command = commandStore.commands.find(c => c.id === id)
    if (command && !commandStore.commandIsAvailable(command)) return

    commandStore.bindCommandToFunction(id, f)
    if (command) {
      bindHotkeyToCommand(command.id)
    }
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

  return {
    executeCommand,
    activeCommand,
    activeArgumentIndex,
    activeArgument,
    argumentsList,
    reset,

    bindHotkeyToCommand,
    bindAllHotkeysToCommands,
    bindCommandToFunction,
    getHotkey,
    updateSearchQuery,
    currentSearchQuery,
  }
}

export const useCommandService = createSharedComposable(commandService)
