<script setup lang="ts">
import type { ComboboxSeparatorProps } from 'radix-vue'
import { ComboboxSeparator } from 'radix-vue'
import { cn } from '@/lib/utils'

const props = defineProps<ComboboxSeparatorProps>()
</script>

<template>
  <ComboboxSeparator
    v-bind="props"
    :class="cn('-mx-1 h-px bg-zinc-200 dark:bg-zinc-800', $attrs.class ?? '')"
  >
    <slot />
  </ComboboxSeparator>
</template>
