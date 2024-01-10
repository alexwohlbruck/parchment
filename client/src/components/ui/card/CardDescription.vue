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
  <p :class="cn('text-sm text-zinc-500 dark:text-zinc-400', props.class)">
    <slot />
  </p>
</template>
