import { computed, ref, watch } from 'vue'
import mousetrap from 'mousetrap'
import { useCommandStore } from '@/stores/command.store'
import { Command } from '@/types/command.types'
import { type Command as TCommand } from '@/types/command.types'

const activeCommand = ref<TCommand | null>(null)
const activeArgumentIndex = ref<number | null>(null)
const activeArgument = computed(() => {
  if (activeCommand.value && activeArgumentIndex.value !== null) {
    return activeCommand.value.arguments?.[activeArgumentIndex.value]
  }
  return null
})
const argumentsList = ref<string[]>([])

export function useCommandService() {
  const commandStore = useCommandStore()

  function executeCommand(command: TCommand, ...args: string[]) {
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

  function bindCommandToFunction(id: string, f: Function) {
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

  watch(activeArgument, (newVal, prevVal) => {
    console.log(newVal)
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
    bindCommandToFunction,
    getHotkey,
  }
}
