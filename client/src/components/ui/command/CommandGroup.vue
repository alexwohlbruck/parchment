<script setup lang="ts">
import type { ComboboxGroupProps } from 'radix-vue'
import { ComboboxGroup, ComboboxLabel } from 'radix-vue'
import { cn } from '@/lib/utils'

const props = defineProps<ComboboxGroupProps & {
  heading?: string
}>()
</script>

<template>
  <ComboboxGroup
    v-bind="props"
    :class="cn('overflow-hidden p-1 text-zinc-950 dark:text-zinc-50', $attrs.class ?? '')"
  >
    <ComboboxLabel v-if="heading" class="px-2 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
      {{ heading }}
    </ComboboxLabel>
    <slot />
  </ComboboxGroup>
</template>
