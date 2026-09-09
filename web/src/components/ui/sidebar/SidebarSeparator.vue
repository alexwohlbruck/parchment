<script setup lang="ts">
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: string }>()
</script>

<template>
  <div :class="cn('h-px shrink-0 bg-border/70 mx-2 my-1', props.class)" />
</template>
