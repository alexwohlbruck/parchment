import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'
import {
  recordCommandUse,
  suggestCommands,
  type CommandUse,
} from '@/lib/command/command-usage'

export const useCommandUsageStore = defineStore('command-usage', () => {
  const uses = useStorage<CommandUse[]>('parchment-command-uses', [])

  function record(id: string) {
    uses.value = recordCommandUse(uses.value, id, Date.now())
  }

  function suggest<T extends { id: string }>(commands: T[]) {
    return suggestCommands(commands, uses.value, Date.now())
  }

  return { uses, record, suggest }
})
