<script setup lang="ts">
import {
  ContextMenuItem,
  type ContextMenuItemEmits,
  type ContextMenuItemProps,
  useEmitAsProps,
} from 'radix-vue'
import { cn } from '@/lib/utils'

const props = defineProps<ContextMenuItemProps & { class?: string; inset?: boolean }>()
const emits = defineEmits<ContextMenuItemEmits>()
</script>

<template>
  <ContextMenuItem
    v-bind="{ ...props, ...useEmitAsProps(emits) }"
    :class="[
      cn(
        'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-zinc-100 focus:text-zinc-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-zinc-800 dark:focus:text-zinc-50',
        inset && 'pl-8',
        props.class,
      ),
    ]"
  >
    <slot />
  </ContextMenuItem>
</template>
