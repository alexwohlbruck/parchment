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

  function executeCommand(command: TCommand, ...args: ArgumentType[]) {
    if (!command.action) return

    activeCommand.value = command
    argumentsList.value.push(...args)
    activeArgumentIndex.value = (activeArgumentIndex.value ?? 0) + args.length

    const argsFilled = command.arguments
      ? activeArgumentIndex.value >= command.arguments.length
      : true

    if (argsFilled) {
      command.action(...argumentsList.value)
      reset()
    }
  }

  function reset() {
    activeCommand.value = null
    activeArgumentIndex.value = null
    argumentsList.value = []
  }

  function bindHotkeyToCommand(command: Command) {
    if (!command.hotkey || !command.action) return

    const bindingString = command.hotkey.join('+')

    mousetrap.bind(bindingString, e => {
      if (command.action) {
        e.preventDefault()
        executeCommand(command)
      }
    })
  }

  function bindAllHotkeysToCommands() {
    commandStore.commands.forEach(command => {
      bindHotkeyToCommand(command)
    })
  }

  function bindCommandToFunction(id: CommandName, f: Function) {
    commandStore.bindCommandToFunction(id, f)
    const command = commandStore.commands.find(c => c.id === id)
    if (command) {
      bindHotkeyToCommand(command)
    }
  }

  function getHotkey(id: string) {
    const command = commandStore.commands.find(c => c.id === id)
    return command?.hotkey
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
  }
}

export const useCommandService = createSharedComposable(commandService)
