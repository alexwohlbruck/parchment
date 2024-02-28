import { useCommandStore } from '@/stores/command.store'
import { Command } from '@/types/command.types'
import mousetrap from 'mousetrap'

export function useCommandService() {
  const commandStore = useCommandStore()

  function bindHotkeyToCommand(command: Command) {
    if (!command.hotkey || !command.action) return

    const bindingString = command.hotkey.join('+')

    mousetrap.bind(bindingString, e => {
      if (command.action) {
        e.preventDefault()
        command.action()
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

  return {
    bindHotkeyToCommand,
    bindAllHotkeysToCommands,
    bindCommandToFunction,
    getHotkey,
  }
}
