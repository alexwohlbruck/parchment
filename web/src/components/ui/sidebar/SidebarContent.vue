<script setup lang="ts">
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: string }>()
</script>

<template>
  <div
    :class="
      cn(
        'flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto overflow-x-hidden px-2 py-1',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
