<script setup lang="ts">
import { cn } from '@/lib/utils'

const props = defineProps({
  class: {
    type: String,
    default: '',
  },
})
</script>

<template>
  <div
    :class="
      cn(
        'rounded-lg border bg-card text-card-foreground shadow-[0_1px_3px_rgba(0,0,0,0.08)] inset-shadow-[0_1px_0_rgba(255,255,255,0.7)] dark:inset-shadow-[0_1px_0_rgba(255,255,255,0.05)]',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
