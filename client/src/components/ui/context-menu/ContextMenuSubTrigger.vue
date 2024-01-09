<script setup lang="ts">
import {
  ContextMenuSubTrigger,
  type ContextMenuSubTriggerProps,
} from 'radix-vue'
import { ChevronRight } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

const props = defineProps<ContextMenuSubTriggerProps & { class?: string; inset?: boolean }>()
</script>

<template>
  <ContextMenuSubTrigger
    v-bind="props"
    :class="[
      cn(
        'flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-zinc-100 focus:text-zinc-900 data-[state=open]:bg-zinc-100 data-[state=open]:text-zinc-900 dark:focus:bg-zinc-800 dark:focus:text-zinc-50 dark:data-[state=open]:bg-zinc-800 dark:data-[state=open]:text-zinc-50',
        inset && 'pl-8',
        props.class,
      ),
    ]"
  >
    <slot />
    <ChevronRight class="ml-auto h-4 w-4" />
  </ContextMenuSubTrigger>
</template>
