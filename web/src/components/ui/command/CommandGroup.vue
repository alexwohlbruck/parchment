<script setup lang="ts">
import type { ComboboxGroupProps } from 'reka-ui'
import { ComboboxGroup, ComboboxLabel } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<
  ComboboxGroupProps & {
    heading?: string
  }
>()
</script>

<template>
  <ComboboxGroup
    v-bind="props"
    :class="cn('overflow-hidden p-1 text-foreground', $attrs.class ?? '')"
  >
    <div v-if="heading" class="flex items-center justify-between gap-2 pr-2">
      <ComboboxLabel class="px-2 py-1.5 text-xs font-medium text-muted-foreground">
        {{ heading }}
      </ComboboxLabel>
      <slot name="heading-action" />
    </div>
    <slot />
  </ComboboxGroup>
</template>
