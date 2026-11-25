import {
  computed,
  onScopeDispose,
  toValue,
  watch,
  watchEffect,
  type MaybeRefOrGetter,
} from 'vue'
import { useCommandStore } from '@/stores/command.store'
import { useCommandService } from '@/services/command.service'
import { bindHotkey } from '@/composables/useHotkeys'
import type { Command } from '@/types/command.types'

export type ContextualCommand = Omit<Command, 'context' | 'category'>

/**
 * Offers commands in the palette and the shortcuts menu for as long as the
 * calling component lives, listed under `context`.
 */
export function useContextualCommands(
  context: MaybeRefOrGetter<string | null | undefined>,
  commands: MaybeRefOrGetter<ContextualCommand[]>,
) {
  const commandStore = useCommandStore()
  const { executeCommand } = useCommandService()
  const owner = Symbol('contextual-commands')

  const registered = computed<Command[]>(() => {
    const name = toValue(context)
    if (!name) return []
    return toValue(commands).map(command => ({ ...command, context: name }))
  })

  watchEffect(() => commandStore.setContextualCommands(owner, registered.value))

  watch(
    () => registered.value.filter(command => command.hotkey),
    (withHotkeys, _, onCleanup) => {
      const unbinds = withHotkeys.map(command =>
        bindHotkey({
          key: command.hotkey!,
          handler: () => {
            if (commandStore.commandIsAvailable(command)) executeCommand(command)
          },
        }),
      )
      onCleanup(() => unbinds.forEach(unbind => unbind()))
    },
    { immediate: true },
  )

  onScopeDispose(() => commandStore.clearContextualCommands(owner))
}
