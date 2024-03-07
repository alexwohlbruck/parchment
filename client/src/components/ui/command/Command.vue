<script setup lang="ts">
import type { ComboboxRootEmits, ComboboxRootProps } from 'radix-vue'
import { ComboboxRoot, useForwardPropsEmits } from 'radix-vue'
import { cn } from '@/lib/utils'

const props = defineProps<ComboboxRootProps>()
const emits = defineEmits<ComboboxRootEmits>()

const forwarded = useForwardPropsEmits(props, emits)

// TODO:
// function filterFunction(val: any[], term: string): string[] {
//   return val.filter(item => item.toLowerCase().includes(term.toLowerCase()))
// }
// Add to ComboboxRoot props:
// :filter-function="filterFunction"
</script>

<template>
  <ComboboxRoot
    v-bind="forwarded"
    :class="
      cn(
        'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground',
        $attrs.class ?? '',
      )
    "
  >
    <slot />
  </ComboboxRoot>
</template>
