<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <thead
    :class="
      cn(
        '[&_tr]:border-b bg-parchment-50 dark:bg-parchment-600/10 border-border',
        props.class,
      )
    "
  >
    <slot />
  </thead>
</template>
