<script setup lang="ts">
import { cva } from 'class-variance-authority'
import { computed } from 'vue'
import { type Hotkey } from '@/types/command.types'
import { useCommandService } from '@/services/command.service'

const commandService = useCommandService()

type KbdProps = {
  as?: string
  size?: 'xs' | 'sm' | 'md'
} & (
  | { hotkey: Hotkey; commandId?: never }
  | { commandId: string; hotkey?: never }
)

const props = withDefaults(defineProps<KbdProps>(), {
  as: 'kbd',
  size: 'sm',
})

const kbdClass = computed(() => {
  return cva(
    'inline-flex items-center whitespace-nowrap pointer-events-none h-5 select-none items-center gap-1 rounded border border-border bg-muted text-nowrap font-sans font-medium',
    {
      variants: {
        size: {
          xs: 'min-h-[16px] text-[10px] h-4 px-1',
          sm: 'min-h-[20px] text-[11px] h-5 px-1',
          md: 'min-h-[24px] text-[12px] h-6 px-1.5',
        },
      },
    },
  )({
    size: props.size,
  })
})

const hotkey = computed(() => {
  if (props.hotkey) {
    return props.hotkey
  } else if (props.commandId) {
    return commandService.getHotkey(props.commandId) ?? []
  }
  return []
})

const displayString = computed(() => {
  return hotkey.value
    .map(key => {
      if (key === 'meta' || key === 'mod') return '⌘'
      if (key === 'ctrl') return 'Ctrl'
      if (key === 'shift') return 'Shift'
      if (key === 'alt') return 'Alt'
      return key.toUpperCase()
    })
    .join(' ')
})
</script>

<template>
  <component :is="props.as" :class="kbdClass">
    {{ displayString }}
  </component>
</template>
