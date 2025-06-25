<script setup lang="ts">
import { SelectIcon, SelectTrigger, type SelectTriggerProps } from 'reka-ui'
import { ChevronDown } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<SelectTriggerProps & { class?: string; invalid?: boolean }>(),
  {
    class: '',
    invalid: false,
  },
)
</script>

<template>
  <SelectTrigger
    v-bind="props"
    :class="[
      cn(
        'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-hidden focus:ring-inset focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap [&>span]:truncate [&>span]:min-w-0',
        props.class,
      ),
      props.invalid
        ? 'ring-destructive! ring-2 placeholder:text-destructive!'
        : '',
    ]"
  >
    <slot />
    <SelectIcon as-child>
      <ChevronDown class="size-4 opacity-50" />
    </SelectIcon>
  </SelectTrigger>
</template>
